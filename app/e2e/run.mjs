// App e2e orchestrator: anvil (Monad mode, 400 ms blocks) → DeployDemo → next dev (wired to
// the local deployment, local-key wallet) → next build + start → Playwright at phone size → teardown.
// Needs Foundry (anvil, forge, cast). Run: pnpm --filter @floor/app e2e
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ANVIL_PORT = 8645;
const APP_PORT = 3101;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const contracts = fileURLToPath(new URL('../../contracts/', import.meta.url));
const app = fileURLToPath(new URL('../', import.meta.url));
const depFile = `deployments/e2e-app-${ANVIL_PORT}.json`;
const MNEMONIC = 'test test test test test test test test test test test junk';
// Foundry's public test mnemonic: anvil's pre-funded dev accounts (local chain only).
const key = (i) =>
  spawnSync('cast', ['wallet', 'private-key', MNEMONIC, String(i)], {
    encoding: 'utf8',
  }).stdout.trim();

const children = [];
const cleanup = () => {
  for (const c of children) c.kill('SIGTERM');
  rmSync(contracts + depFile, { force: true });
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

children.push(
  spawn('anvil', [
    '--network',
    'monad',
    '--port',
    String(ANVIL_PORT),
    '--block-time',
    '0.4',
    '--silent',
  ]),
);
await waitFor(
  async () =>
    (
      await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      })
    ).ok,
  20_000,
  'anvil',
);

const deploy = spawnSync(
  'forge',
  ['script', 'script/DeployDemo.s.sol', '--rpc-url', RPC, '--broadcast', '--slow'],
  {
    cwd: contracts,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOYER_PRIVATE_KEY: key(0),
      DEPLOYMENTS_FILE: depFile,
      FOUNDRY_BROADCAST: 'broadcast-rehearsal',
    },
  },
);
if (deploy.status !== 0) {
  console.error(deploy.stdout, deploy.stderr);
  process.exit(1);
}
const deployment = readFileSync(contracts + depFile, 'utf8');

const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_CHAIN_ID: '31337',
  NEXT_PUBLIC_RPC_URL: RPC,
  NEXT_PUBLIC_DEMO_MODE: 'true',
  NEXT_PUBLIC_DEPLOYMENT: JSON.stringify(JSON.parse(deployment)),
  NEXT_PUBLIC_E2E_WALLET_KEY: key(2), // the "user" (local-key wallet, anvil only)
  DEMO_OPERATOR_PRIVATE_KEY: key(0), // MockOracle/MockRouter owner = deployer
  KEEPER_PRIVATE_KEY: key(1), // on-demand keeper: a different account (permissionless)
};
// Test what ships: a production build (NEXT_PUBLIC_* values are baked in at build time).
const build = spawnSync('pnpm', ['exec', 'next', 'build'], { cwd: app, env, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}
const next = spawn('pnpm', ['exec', 'next', 'start', '--port', String(APP_PORT)], {
  cwd: app,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
children.push(next);
let log = '';
next.stdout.on('data', (d) => (log += d));
next.stderr.on('data', (d) => (log += d));
await waitFor(
  async () => (await fetch(`http://127.0.0.1:${APP_PORT}/`)).ok,
  120_000,
  'next start',
).catch((e) => {
  console.error(log);
  throw e;
});

const pw = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  cwd: app,
  stdio: 'inherit',
  env: { ...env, APP_URL: `http://127.0.0.1:${APP_PORT}` },
});
if (pw.status !== 0)
  console.error(
    log
      .split('\n')
      .filter((l) => /error|warn/i.test(l))
      .slice(-30)
      .join('\n'),
  );
process.exit(pw.status ?? 1);
