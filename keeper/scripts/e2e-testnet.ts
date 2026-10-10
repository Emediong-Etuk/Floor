/**
 * Testnet end-to-end (build prompt §10): mint test WMON → protect it with a bracket → crash
 * the MockOracle price below the floor → the keeper fills → report the latency → restore the
 * price. Runs the keeper in-process against contracts/deployments/10143.json.
 *
 *   KEEPER_PRIVATE_KEY=...   keeper (needs testnet MON for gas)
 *   E2E_USER_PRIVATE_KEY=... the "user" (defaults to the keeper key)
 *   E2E_OPERATOR_PRIVATE_KEY=... MockOracle owner/operator that moves the price
 *                             (defaults to DEPLOYER_PRIVATE_KEY, then the keeper key)
 *   RPC_HTTP_URL (default https://testnet-rpc.monad.xyz), RPC_WS_URL (optional)
 *
 * Keys may be given with or without 0x. Run: pnpm e2e:testnet
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  floorOrdersAbi,
  mockErc20Abi,
  mockOracleAbi,
  monadTestnet,
  OrderStatus,
} from '@floor/shared';
import { loadConfig } from '../src/config.ts';
import { run } from '../src/index.ts';

const hex = (k: string) => (k.startsWith('0x') ? k : `0x${k}`) as Hex;
const env = process.env;
const keeperKey = env.KEEPER_PRIVATE_KEY;
if (!keeperKey) throw new Error('set KEEPER_PRIVATE_KEY');
const userKey = env.E2E_USER_PRIVATE_KEY || keeperKey;
const operatorKey = env.E2E_OPERATOR_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY || keeperKey;
const rpc = env.RPC_HTTP_URL || 'https://testnet-rpc.monad.xyz';
const deploymentFile = fileURLToPath(
  new URL('../../contracts/deployments/10143.json', import.meta.url),
);
const d = JSON.parse(readFileSync(deploymentFile, 'utf8')) as {
  floorOrders: Address;
  oracle: Address;
  tokens: { WMON: Address; USDC: Address };
};

const transport = http(rpc, { retryCount: 5 });
const pub = createPublicClient({ chain: monadTestnet, transport, pollingInterval: 200 });
const user = createWalletClient({
  account: privateKeyToAccount(hex(userKey)),
  chain: monadTestnet,
  transport,
});
const operator = createWalletClient({
  account: privateKeyToAccount(hex(operatorKey)),
  chain: monadTestnet,
  transport,
});

async function confirm(hash: Hex) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`tx reverted: ${hash}`);
  return r;
}
const status = async (id: bigint) =>
  (
    await pub.readContract({
      address: d.floorOrders,
      abi: floorOrdersAbi,
      functionName: 'getOrder',
      args: [id],
    })
  ).status;

const keeper = await run(
  loadConfig({
    ...env,
    DEPLOYMENT_FILE: deploymentFile,
    RPC_HTTP_URL: rpc,
    KEEPER_PRIVATE_KEY: keeperKey,
    HEALTH_PORT: env.HEALTH_PORT || '8787',
    LOG_LEVEL: env.LOG_LEVEL || 'warn',
  }),
);
let exitCode = 1;
try {
  const amount = 1_000n * 10n ** 18n;
  const [price] = await pub.readContract({
    address: d.oracle,
    abi: mockOracleAbi,
    functionName: 'getPriceE18',
    args: [d.tokens.WMON],
  });
  const floor = (price * 90n) / 100n;
  console.log(`WMON demo price $${Number(price) / 1e18}, floor $${Number(floor) / 1e18}`);

  await confirm(
    await user.writeContract({
      address: d.tokens.WMON,
      abi: mockErc20Abi,
      functionName: 'mint',
      args: [user.account.address, amount],
    }),
  );
  await confirm(
    await user.writeContract({
      address: d.tokens.WMON,
      abi: mockErc20Abi,
      functionName: 'approve',
      args: [d.floorOrders, amount],
    }),
  );
  const id = await pub.readContract({
    address: d.floorOrders,
    abi: floorOrdersAbi,
    functionName: 'nextOrderId',
  });
  const created = await confirm(
    await user.writeContract({
      address: d.floorOrders,
      abi: floorOrdersAbi,
      functionName: 'createBracket',
      args: [d.tokens.WMON, d.tokens.USDC, amount, floor, (price * 120n) / 100n, 0n, 100, 0n],
    }),
  );
  console.log(`bracket ${id}/${id + 1n} created in block ${created.blockNumber}`);
  for (let i = 0; i < 50 && !keeper.keeper.orders.has(id); i++)
    await new Promise((r) => setTimeout(r, 200));

  const crash = await confirm(
    await operator.writeContract({
      address: d.oracle,
      abi: mockOracleAbi,
      functionName: 'setPrice',
      args: [d.tokens.WMON, (price * 80n) / 100n],
    }),
  );
  const t0 = Date.now();
  console.log(`price crashed to $${(Number(price) * 0.8) / 1e18} in block ${crash.blockNumber}`);
  while ((await status(id)) !== OrderStatus.FILLED) {
    if (Date.now() - t0 > 30_000) throw new Error('not filled within 30 s');
    await new Promise((r) => setTimeout(r, 100));
  }
  const ms = Date.now() - t0;
  const o = await pub.readContract({
    address: d.floorOrders,
    abi: floorOrdersAbi,
    functionName: 'getOrder',
    args: [id],
  });
  console.log(
    `FILLED ${ms} ms after the crash confirmed; owner got ${Number(o.amountOut) / 1e6} USDC`,
  );
  console.log(
    `keeper-measured latency (trigger seen → receipt): ${keeper.metrics.lastFillLatencyMs} ms`,
  );
  console.log(
    `sibling ${id + 1n} status: ${(await status(id + 1n)) === OrderStatus.CANCELLED ? 'CANCELLED' : 'unexpected'}`,
  );
  exitCode = ms <= 3_000 ? 0 : 2;
  if (exitCode) console.log('slower than the 3 s target');

  await confirm(
    await operator.writeContract({
      address: d.oracle,
      abi: mockOracleAbi,
      functionName: 'setPrice',
      args: [d.tokens.WMON, price],
    }),
  );
  console.log('demo price restored');
} finally {
  await keeper.stop();
  process.exit(exitCode);
}
