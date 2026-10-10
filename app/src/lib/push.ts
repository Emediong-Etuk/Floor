/**
 * Server-only web push (build prompt §8.4). Subscriptions are stored per wallet address in
 * Upstash Redis (REST API, free tier) or, without credentials, in memory (local dev and e2e).
 * Payloads are short, plain-English summaries of keeper events.
 */
import webpush, { type PushSubscription } from 'web-push';
import { isAddress, verifyMessage, type Address, type Hex } from 'viem';
import type { NotifyEvent } from '@floor/keeper/notifier';
import { tokenByAddress, USDC } from './config';
import { amount, usd } from './format';
import { SIGNATURE_MAX_AGE_MS, subscribeMessage } from './push-message';

// ------------------------------------------------------------------ store

export interface SubStore {
  add(owner: string, sub: PushSubscription): Promise<void>;
  list(owner: string): Promise<PushSubscription[]>;
  remove(owner: string, endpoint: string): Promise<void>;
}

const keyFor = (owner: string) => `floor:push:${owner.toLowerCase()}`;

/** Upstash Redis over its REST API (no SDK): one hash per wallet, field = endpoint. */
export class UpstashStore implements SubStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async cmd<T>(...args: string[]): Promise<T> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    return ((await res.json()) as { result: T }).result;
  }

  async add(owner: string, sub: PushSubscription) {
    await this.cmd('HSET', keyFor(owner), sub.endpoint, JSON.stringify(sub));
  }
  async list(owner: string) {
    const vals = await this.cmd<string[] | null>('HVALS', keyFor(owner));
    return (vals ?? []).map((v) => JSON.parse(v) as PushSubscription);
  }
  async remove(owner: string, endpoint: string) {
    await this.cmd('HDEL', keyFor(owner), endpoint);
  }
}

export class MemoryStore implements SubStore {
  private readonly m = new Map<string, Map<string, PushSubscription>>();
  async add(owner: string, sub: PushSubscription) {
    const k = keyFor(owner);
    if (!this.m.has(k)) this.m.set(k, new Map());
    this.m.get(k)!.set(sub.endpoint, sub);
  }
  async list(owner: string) {
    return [...(this.m.get(keyFor(owner))?.values() ?? [])];
  }
  async remove(owner: string, endpoint: string) {
    this.m.get(keyFor(owner))?.delete(endpoint);
  }
}

let store: SubStore | undefined;
/** Upstash env names from the Upstash console or Vercel's Upstash integration. */
export function getStore(): SubStore {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  store ??= url && token ? new UpstashStore(url, token) : new MemoryStore();
  return store;
}

// ------------------------------------------------------------------ subscribe

export function isPushSubscription(x: unknown): x is PushSubscription {
  const s = x as PushSubscription;
  return (
    typeof s?.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  );
}

/** Checks the wallet signed this device's subscription recently (see push-message.ts). */
export async function verifySubscribe(input: {
  address: string;
  subscription: PushSubscription;
  signature: string;
  issuedAt: string;
  now?: number;
}): Promise<boolean> {
  if (!isAddress(input.address)) return false;
  const issued = Date.parse(input.issuedAt);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(issued) || Math.abs(now - issued) > SIGNATURE_MAX_AGE_MS) return false;
  const message = await subscribeMessage(
    input.address,
    input.subscription.endpoint,
    input.issuedAt,
  );
  try {
    return await verifyMessage({
      address: input.address as Address,
      message,
      signature: input.signature as Hex,
    });
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ payloads

export interface PushPayload {
  title: string;
  body: string;
  /** Same tag per order: "selling" is replaced by "sold" on the device. */
  tag: string;
  url: string;
}

export function payloadFor(event: NotifyEvent | { type: 'welcome' }): PushPayload | null {
  switch (event.type) {
    case 'welcome':
      return {
        title: 'Floor alerts are on',
        body: "We'll tell you the moment a protection sells.",
        tag: 'welcome',
        url: '/',
      };
    case 'selling':
      return {
        title: 'Your floor was hit: selling now',
        body: 'Floor is selling your protected tokens.',
        tag: `order-${event.orderId}`,
        url: '/',
      };
    case 'filled': {
      const t = tokenByAddress(event.tokenIn);
      const sym = t?.symbol ?? 'tokens';
      const lead = event.kind === 'floor' ? 'Floor hit' : 'Cash-out hit';
      const latency =
        event.latencyMs > 0 ? ` · ${(event.latencyMs / 1000).toFixed(1)} s after the trigger` : '';
      return {
        title: `${lead}: sold ${amount(BigInt(event.amountIn), t?.decimals ?? 18)} ${sym}`,
        body: `You got ${amount(BigInt(event.amountOut), USDC.decimals, 2)} USDC at ${usd(BigInt(event.priceE18))}${latency}.`,
        tag: `order-${event.orderId}`,
        url: '/activity',
      };
    }
    case 'waiting-liquidity':
      return {
        title: 'Floor hit: waiting for liquidity',
        body: "The market can't pay within your limit yet. Floor will sell as soon as it can.",
        tag: `order-${event.orderId}`,
        url: `/protection/${event.orderId}`,
      };
    case 'unfillable':
      return {
        title: "Floor can't sell your protection",
        body: 'Your tokens or approval changed. Open Floor to fix it.',
        tag: `order-${event.orderId}`,
        url: `/protection/${event.orderId}`,
      };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ send

export type Sender = (sub: PushSubscription, payload: string) => Promise<unknown>;

let vapidReady: boolean | undefined;
function defaultSender(): Sender | null {
  if (vapidReady === undefined) {
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    vapidReady = Boolean(pub && priv);
    if (pub && priv)
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:alerts@floor.invalid',
        pub,
        priv,
      );
  }
  return vapidReady
    ? (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' })
    : null;
}

/**
 * Push `event` to every device of `owner`. Devices the push service says are gone (404/410)
 * are removed. Never throws: a failed push must not fail a fill or an API call.
 */
export async function notifyOwner(
  owner: string,
  event: Parameters<typeof payloadFor>[0],
  deps: { store?: SubStore; send?: Sender | null } = {},
): Promise<{ sent: number; removed: number; skipped?: string }> {
  const payload = payloadFor(event);
  if (!payload) return { sent: 0, removed: 0, skipped: 'no payload' };
  const send = deps.send === undefined ? defaultSender() : deps.send;
  if (!send) return { sent: 0, removed: 0, skipped: 'push not configured (VAPID keys)' };
  const s = deps.store ?? getStore();
  let sent = 0;
  let removed = 0;
  try {
    for (const sub of await s.list(owner)) {
      try {
        await send(sub, JSON.stringify(payload));
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await s.remove(owner, sub.endpoint);
          removed++;
        }
      }
    }
  } catch (err) {
    console.warn('push failed', String(err));
  }
  return { sent, removed };
}
