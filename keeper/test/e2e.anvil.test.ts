/**
 * End-to-end on a local chain: anvil (Monad mode, 400 ms blocks) → DeployDemo → keeper (its
 * own key, so execution is permissionless) → a user protects WMON → the owner crashes the
 * MockOracle price → the keeper fills. Also covers the liquidity-gap wait, notifications and
 * /health. Needs Foundry (anvil + forge) on PATH; skipped otherwise. CI runs it in the
 * contracts job, which has Foundry.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import {
  floorOrdersAbi,
  mockErc20Abi,
  mockOracleAbi,
  mockRouterAbi,
  OrderStatus,
} from '@floor/shared';
import { loadConfig } from '../src/config.ts';
import { run } from '../src/index.ts';

const hasFoundry =
  spawnSync('anvil', ['--version']).status === 0 && spawnSync('forge', ['--version']).status === 0;

const PORT = 8600 + Math.floor(Math.random() * 300);
const RPC = `http://127.0.0.1:${PORT}`;
const contractsDir = fileURLToPath(new URL('../../contracts/', import.meta.url));
const deploymentFile = `deployments/e2e-${PORT}.json`;
// Foundry's public test mnemonic: anvil's pre-funded dev accounts (local chain only).
const MNEMONIC = 'test test test test test test test test test test test junk';
const keyOf = (i: number) =>
  toHex(mnemonicToAccount(MNEMONIC, { addressIndex: i }).getHdKey().privateKey!);
const owner = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
const user = mnemonicToAccount(MNEMONIC, { addressIndex: 2 });

const chain = defineChain({
  id: 31_337,
  name: 'Anvil',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 200 });
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(RPC) });
const userWallet = createWalletClient({ account: user, chain, transport: http(RPC) });

interface Deployment {
  floorOrders: Address;
  oracle: Address;
  swapTarget: Address;
  tokens: { WMON: Address; USDC: Address };
}

describe.skipIf(!hasFoundry)('keeper e2e on anvil (demo mode)', () => {
  let anvil: ChildProcess;
  let d: Deployment;
  let keeperHandle: Awaited<ReturnType<typeof run>>;
  let notifyServer: Server;
  const notifications: { type: string; latencyMs?: number }[] = [];

  beforeAll(async () => {
    anvil = spawn('anvil', [
      '--network',
      'monad',
      '--port',
      String(PORT),
      '--block-time',
      '0.4',
      '--silent',
    ]);
    for (let i = 0; i < 50; i++) {
      try {
        await pub.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const deploy = spawnSync(
      'forge',
      ['script', 'script/DeployDemo.s.sol', '--rpc-url', RPC, '--broadcast', '--slow'],
      {
        cwd: contractsDir,
        env: {
          ...process.env,
          DEPLOYER_PRIVATE_KEY: keyOf(0),
          DEPLOYMENTS_FILE: deploymentFile,
          FOUNDRY_BROADCAST: 'broadcast-rehearsal',
        },
        encoding: 'utf8',
      },
    );
    if (deploy.status !== 0)
      throw new Error(`DeployDemo failed:\n${deploy.stderr}\n${deploy.stdout}`);
    d = JSON.parse(readFileSync(contractsDir + deploymentFile, 'utf8')) as Deployment;

    // Stand-in for the app's /api/notify.
    notifyServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        if (req.headers.authorization === 'Bearer e2e-secret') notifications.push(JSON.parse(body));
        res.end('{}');
      });
    });
    await new Promise<void>((r) => notifyServer.listen(0, r));
    const notifyPort = (notifyServer.address() as AddressInfo).port;

    keeperHandle = await run(
      loadConfig({
        DEPLOYMENT_FILE: contractsDir + deploymentFile,
        RPC_HTTP_URL: RPC,
        KEEPER_PRIVATE_KEY: keyOf(1), // not the owner: anyone can execute
        NOTIFY_URL: `http://127.0.0.1:${notifyPort}/api/notify`,
        NOTIFY_SECRET: 'e2e-secret',
        HEALTH_PORT: '0',
        POLL_INTERVAL_MS: '200',
        LOG_LEVEL: 'silent',
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await keeperHandle?.stop();
    notifyServer?.close();
    anvil?.kill();
    rmSync(contractsDir + deploymentFile, { force: true });
  });

  async function write(hash: Promise<Hex>) {
    const r = await pub.waitForTransactionReceipt({ hash: await hash });
    expect(r.status).toBe('success');
    return r;
  }

  async function protect(amount: bigint, floorPrice: bigint): Promise<bigint> {
    await write(
      userWallet.writeContract({
        address: d.tokens.WMON,
        abi: mockErc20Abi,
        functionName: 'mint',
        args: [user.address, amount],
      }),
    );
    await write(
      userWallet.writeContract({
        address: d.tokens.WMON,
        abi: mockErc20Abi,
        functionName: 'approve',
        args: [d.floorOrders, amount],
      }),
    );
    const next = await pub.readContract({
      address: d.floorOrders,
      abi: floorOrdersAbi,
      functionName: 'nextOrderId',
    });
    await write(
      userWallet.writeContract({
        address: d.floorOrders,
        abi: floorOrdersAbi,
        functionName: 'createBracket',
        args: [d.tokens.WMON, d.tokens.USDC, amount, floorPrice, floorPrice * 2n, 0n, 100, 0n],
      }),
    );
    return next;
  }

  const setPrice = (p: bigint) =>
    write(
      ownerWallet.writeContract({
        address: d.oracle,
        abi: mockOracleAbi,
        functionName: 'setPrice',
        args: [d.tokens.WMON, p],
      }),
    );

  async function statusOf(id: bigint) {
    const o = await pub.readContract({
      address: d.floorOrders,
      abi: floorOrdersAbi,
      functionName: 'getOrder',
      args: [id],
    });
    return o.status;
  }

  async function waitFor(cond: () => Promise<boolean>, timeoutMs: number) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await cond()) return Date.now() - start;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out');
  }

  it('fills a protected order soon after the price crashes through the floor', async () => {
    const id = await protect(10_000n * 10n ** 18n, 225n * 10n ** 14n); // floor $0.0225
    await waitFor(async () => keeperHandle.keeper.orders.has(id), 5_000); // picked up via event
    const usdcBefore = await pub.readContract({
      address: d.tokens.USDC,
      abi: mockErc20Abi,
      functionName: 'balanceOf',
      args: [user.address],
    });

    await setPrice(2n * 10n ** 16n); // $0.025 → $0.02 (−20%)
    const ms = await waitFor(async () => (await statusOf(id)) === OrderStatus.FILLED, 10_000);
    console.log(`keeper filled ${ms} ms after the crash tx confirmed (400 ms blocks)`);
    expect(ms).toBeLessThan(3_000); // §12 Phase 3 target: within 3 s

    expect(await statusOf(id + 1n)).toBe(OrderStatus.CANCELLED); // OCO sibling
    const usdcAfter = await pub.readContract({
      address: d.tokens.USDC,
      abi: mockErc20Abi,
      functionName: 'balanceOf',
      args: [user.address],
    });
    const gross = (200n * 10n ** 6n * 9_980n) / 10_000n; // $200 less the router's 0.2% spread
    expect(usdcAfter - usdcBefore).toBe(gross - (gross * 10n) / 10_000n); // less the 0.1% executor fee

    await waitFor(async () => notifications.some((n) => n.type === 'filled'), 5_000);
    expect(notifications.map((n) => n.type)).toEqual(expect.arrayContaining(['selling', 'filled']));
    await setPrice(25n * 10n ** 15n);
  });

  it('waits through a liquidity gap and fills once liquidity returns', async () => {
    await write(
      ownerWallet.writeContract({
        address: d.swapTarget,
        abi: mockRouterAbi,
        functionName: 'setLiquidityGap',
        args: [true, 300],
      }),
    );
    const id = await protect(1_000n * 10n ** 18n, 225n * 10n ** 14n);
    await waitFor(async () => keeperHandle.keeper.orders.has(id), 5_000);
    await setPrice(2n * 10n ** 16n);

    await waitFor(async () => notifications.some((n) => n.type === 'waiting-liquidity'), 5_000);
    expect(await statusOf(id)).toBe(OrderStatus.ACTIVE); // FloorOrders refused the bad fill

    await write(
      ownerWallet.writeContract({
        address: d.swapTarget,
        abi: mockRouterAbi,
        functionName: 'setLiquidityGap',
        args: [false, 0],
      }),
    );
    await waitFor(async () => (await statusOf(id)) === OrderStatus.FILLED, 10_000);
    await setPrice(25n * 10n ** 15n);
  });

  it('serves /health and /metrics', async () => {
    const port = (keeperHandle.server.address() as AddressInfo).port;
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as Record<
      string,
      unknown
    >;
    expect(health.chainId).toBe(31_337);
    expect(health.mode).toBe('demo');
    expect(Number(health.lastBlock)).toBeGreaterThan(0);
    expect(health.lastFillLatencyMs).toEqual(expect.any(Number));
    const metrics = (await (await fetch(`http://127.0.0.1:${port}/metrics`)).json()) as {
      fills: number;
    };
    expect(metrics.fills).toBe(2);
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });
});
