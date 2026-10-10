/**
 * Server-only helpers for the API routes (never imported by client components).
 * Keys come from server env vars (Vercel project settings), never NEXT_PUBLIC_*.
 */
import { createPublicClient, createWalletClient, http, isHex, type Hex } from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '@floor/keeper/config';
import { sweep, type SweepResult } from '@floor/keeper/sweep';
import { CHAIN_ID, DEMO_MODE, RPC_URL, chain, deployment } from './config';
import { notifyOwner } from './push';

const rpc = process.env.RPC_HTTP_URL || RPC_URL;

function key(v: string | undefined): Hex | undefined {
  if (!v) return undefined;
  const k = v.startsWith('0x') ? v : `0x${v}`;
  return isHex(k) && k.length === 66 ? (k as Hex) : undefined;
}

export const operatorKey = key(process.env.DEMO_OPERATOR_PRIVATE_KEY);
/** On-demand keeper key (D-011); falls back to the operator key so one funded key is enough. */
export const keeperKey = key(process.env.KEEPER_PRIVATE_KEY) ?? operatorKey;

export const serverClient = createPublicClient({ chain, transport: http(rpc, { retryCount: 3 }) });

let operatorWallet: ReturnType<typeof makeWallet> | undefined;
function makeWallet(k: Hex) {
  // Local nonce manager: back-to-back operator txs in one request never collide.
  return createWalletClient({
    account: privateKeyToAccount(k, { nonceManager }),
    chain,
    transport: http(rpc),
  });
}
export function operator() {
  if (!operatorKey)
    throw new HttpError(503, 'Demo operator key is not configured (DEMO_OPERATOR_PRIVATE_KEY).');
  operatorWallet ??= makeWallet(operatorKey);
  return operatorWallet;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireDemo() {
  if (!DEMO_MODE || deployment.mode !== 'demo')
    throw new HttpError(404, 'Demo endpoints exist in demo mode only.');
}

/** JSON response; bigints become strings. */
export function json(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Try again in a moment.' }, 500);
  });
}

// ------------------------------------------------------------------ on-demand keeper (D-011)

let running: Promise<SweepResult> | undefined;
export let lastSweep: (SweepResult & { at: number }) | undefined;

/**
 * One keeper pass with the same Keeper code as the always-on process. Concurrent callers on
 * this instance share the pass in progress instead of starting another.
 */
export function runSweep(maxMs = 12_000): Promise<SweepResult> {
  if (!keeperKey)
    return Promise.reject(new HttpError(503, 'Keeper key is not configured (KEEPER_PRIVATE_KEY).'));
  running ??= sweep(
    loadConfig({
      MODE: 'demo',
      CHAIN_ID: String(CHAIN_ID),
      RPC_HTTP_URL: rpc,
      KEEPER_PRIVATE_KEY: keeperKey,
      FLOOR_ADDRESS: deployment.floorOrders,
      ORACLE_ADDRESS: deployment.oracle,
      SWAP_TARGET: deployment.swapTarget,
      LOG_LEVEL: 'warn',
    }),
    { maxMs },
  )
    .then(async (r) => {
      lastSweep = { ...r, at: Date.now() };
      // Push straight from here (no HTTP hop to /api/notify). Push failures never fail the sweep.
      await Promise.all(r.events.map((e) => notifyOwner(e.owner, e)));
      return r;
    })
    .finally(() => {
      running = undefined;
    });
  return running;
}

/** Tiny per-instance rate limiter (enough to stop accidental hammering of the demo). */
const hits = new Map<string, number>();
export function rateLimit(id: string, windowMs: number): void {
  const now = Date.now();
  const last = hits.get(id) ?? 0;
  if (now - last < windowMs) throw new HttpError(429, 'Slow down a little and try again.');
  hits.set(id, now);
}
