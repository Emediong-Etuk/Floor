import { isAddress, isHex, type Address, type Hex } from 'viem';
import { z } from 'zod';

/**
 * Keeper configuration, parsed from environment variables (see keeper/.env.example).
 * Parsing fails fast with every problem listed, and never echoes secret values.
 */
const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), 'must be a 0x-prefixed 20-byte address')
  .transform((v) => v as Address);

const privateKey = z
  .string()
  .refine((v) => isHex(v) && v.length === 66, 'must be a 0x-prefixed 32-byte hex key')
  .transform((v) => v as Hex);

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z
  .object({
    MODE: z.enum(['demo', 'live']),
    CHAIN_ID: z.coerce
      .number()
      .int()
      .refine((v) => v === 143 || v === 10143, 'must be 143 or 10143'),
    RPC_HTTP_URL: z.url(),
    RPC_WS_URL: z.url().refine((v) => v.startsWith('ws'), 'must be a ws:// or wss:// URL'),
    KEEPER_PRIVATE_KEY: privateKey,
    FLOOR_ADDRESS: address,
    ORACLE_ADDRESS: address,
    ZEROX_API_KEY: optionalString,
    ZEROX_API_URL: z.url().default('https://api.0x.org'),
    HERMES_URL: optionalString,
    HERMES_API_KEY: optionalString,
    NOTIFY_URL: optionalString,
    NOTIFY_SECRET: optionalString,
    GAS_MULTIPLIER: z.coerce.number().min(1).max(2).default(1.15),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((c, ctx) => {
    // Live mode sells through the 0x Swap API, which requires an API key.
    if (c.MODE === 'live' && !c.ZEROX_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ZEROX_API_KEY'], message: 'required when MODE=live' });
    }
    // Demo mode runs against MockOracle/MockRouter on testnet only.
    if (c.MODE === 'demo' && c.CHAIN_ID !== 10143) {
      ctx.addIssue({
        code: 'custom',
        path: ['CHAIN_ID'],
        message: 'MODE=demo runs on testnet (10143) only',
      });
    }
    if (c.NOTIFY_URL && !c.NOTIFY_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['NOTIFY_SECRET'],
        message: 'required when NOTIFY_URL is set',
      });
    }
  });

export type KeeperConfig = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): KeeperConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Only variable names and rule messages are printed, never the values.
    const problems = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid keeper config:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
