import { readFileSync } from 'node:fs';
import { isAddress, isHex, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { MAINNET_CONTRACTS } from '@floor/shared';

/**
 * Keeper configuration from environment variables (see keeper/.env.example).
 *
 * `DEPLOYMENT_FILE` (e.g. ../contracts/deployments/10143.json, written by the deploy scripts)
 * fills MODE, CHAIN_ID, FLOOR_ADDRESS, ORACLE_ADDRESS, SWAP_TARGET and SWAP_SPENDER; explicit
 * env vars win. Parsing fails fast with every problem listed and never echoes secret values.
 */
const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), 'must be a 0x-prefixed 20-byte address')
  .transform((v) => v as Address);

/** Wallets export keys with and without `0x`; accept both. */
const privateKey = z
  .string()
  .transform((v) => (v.startsWith('0x') ? v : `0x${v}`))
  .refine((v) => isHex(v) && v.length === 66, 'must be a 32-byte hex key')
  .transform((v) => v as Hex);

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalUrl = optionalString.refine(
  (v) => v === undefined || URL.canParse(v),
  'must be a URL',
);

const schema = z
  .object({
    MODE: z.enum(['demo', 'live']),
    // 31337 = local anvil (tests and rehearsals only).
    CHAIN_ID: z.coerce
      .number()
      .int()
      .refine((v) => [143, 10143, 31337].includes(v), 'must be 143, 10143 or 31337 (anvil)'),
    RPC_HTTP_URL: z.url(),
    // Optional: without it the keeper polls for new blocks over HTTP.
    RPC_WS_URL: optionalString.refine(
      (v) => v === undefined || /^wss?:\/\//.test(v),
      'must be a ws:// or wss:// URL',
    ),
    KEEPER_PRIVATE_KEY: privateKey,
    FLOOR_ADDRESS: address,
    ORACLE_ADDRESS: address,
    // Venue for demo mode (MockRouter). Live mode defaults to 0x AllowanceHolder.
    SWAP_TARGET: address.optional(),
    SWAP_SPENDER: address.optional(),
    ZEROX_API_KEY: optionalString,
    ZEROX_API_URL: z.url().default('https://api.0x.org'),
    // Pyth Hermes is optional (D-004): without it the keeper uses the sponsored push prices.
    HERMES_URL: optionalUrl,
    HERMES_API_KEY: optionalString,
    NOTIFY_URL: optionalUrl,
    NOTIFY_SECRET: optionalString,
    GAS_MULTIPLIER: z.coerce.number().min(1).max(2).default(1.15),
    HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(8787),
    POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(400),
    RESYNC_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
    // Monad reserve balance: keep the keeper above 10 MON; alert below this.
    LOW_BALANCE_MON: z.coerce.number().min(0).default(12),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (c.MODE === 'live') {
      // Live mode sells through the 0x Swap API, which requires an API key.
      if (!c.ZEROX_API_KEY) issue('ZEROX_API_KEY', 'required when MODE=live');
      if (c.CHAIN_ID === 10143) issue('CHAIN_ID', 'MODE=live runs on mainnet (143) only');
    } else {
      if (c.CHAIN_ID === 143) issue('CHAIN_ID', 'MODE=demo runs on testnet (10143) or anvil only');
      if (!c.SWAP_TARGET) issue('SWAP_TARGET', 'required when MODE=demo (the MockRouter)');
    }
    if (c.NOTIFY_URL && !c.NOTIFY_SECRET) issue('NOTIFY_SECRET', 'required when NOTIFY_URL is set');
    if (c.HERMES_URL && !c.HERMES_API_KEY) issue('HERMES_API_KEY', 'Hermes requires an API key');
  });

export type KeeperConfig = z.infer<typeof schema> & { SWAP_TARGET: Address; SWAP_SPENDER: Address };

interface DeploymentFile {
  mode?: string;
  chainId?: number;
  floorOrders?: string;
  oracle?: string;
  swapTarget?: string;
  swapSpender?: string;
}

/** Env values derived from a deployments/<chainId>.json file. */
export function deploymentEnv(path: string): Record<string, string> {
  const d = JSON.parse(readFileSync(path, 'utf8')) as DeploymentFile;
  const out: Record<string, string> = {};
  if (d.mode) out.MODE = d.mode;
  if (d.chainId !== undefined) out.CHAIN_ID = String(d.chainId);
  if (d.floorOrders) out.FLOOR_ADDRESS = d.floorOrders;
  if (d.oracle) out.ORACLE_ADDRESS = d.oracle;
  if (d.swapTarget) out.SWAP_TARGET = d.swapTarget;
  if (d.swapSpender) out.SWAP_SPENDER = d.swapSpender;
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): KeeperConfig {
  const fromFile = env.DEPLOYMENT_FILE ? deploymentEnv(env.DEPLOYMENT_FILE) : {};
  // Empty env strings count as unset so they don't mask the deployment file.
  const set = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = schema.safeParse({ ...fromFile, ...set });
  if (!parsed.success) {
    // Only variable names and rule messages are printed, never the values.
    const problems = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid keeper config:\n${problems.join('\n')}`);
  }
  const c = parsed.data;
  // Live default venue: 0x AllowanceHolder is both target and spender (D-003).
  const target = c.SWAP_TARGET ?? MAINNET_CONTRACTS.zeroExAllowanceHolder;
  return { ...c, SWAP_TARGET: target, SWAP_SPENDER: c.SWAP_SPENDER ?? target };
}
