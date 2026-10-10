import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { PushSubscription } from 'web-push';
import { MemoryStore, UpstashStore, notifyOwner, payloadFor, verifySubscribe } from '@/lib/push';
import { subscribeMessage } from '@/lib/push-message';
import { TOKENS } from '@/lib/config';

// Throwaway test key (all 0x11), never used on any chain.
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const sub: PushSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};
const WMON = TOKENS.find((t) => t.symbol === 'WMON')!;

async function signed(issuedAt = new Date().toISOString(), endpoint = sub.endpoint) {
  const message = await subscribeMessage(account.address, endpoint, issuedAt);
  return { signature: await account.signMessage({ message }), issuedAt };
}

describe('subscription ownership proof', () => {
  it('accepts a fresh signature from the wallet for this device', async () => {
    const { signature, issuedAt } = await signed();
    expect(
      await verifySubscribe({ address: account.address, subscription: sub, signature, issuedAt }),
    ).toBe(true);
  });

  it('rejects another wallet, another device, an old signature and garbage', async () => {
    const { signature, issuedAt } = await signed();
    const other = privateKeyToAccount(`0x${'22'.repeat(32)}`).address;
    expect(await verifySubscribe({ address: other, subscription: sub, signature, issuedAt })).toBe(
      false,
    );
    const otherDevice = { ...sub, endpoint: 'https://fcm.googleapis.com/fcm/send/zzz' };
    expect(
      await verifySubscribe({
        address: account.address,
        subscription: otherDevice,
        signature,
        issuedAt,
      }),
    ).toBe(false);
    const old = await signed(new Date(Date.now() - 11 * 60_000).toISOString());
    expect(await verifySubscribe({ address: account.address, subscription: sub, ...old })).toBe(
      false,
    );
    expect(
      await verifySubscribe({
        address: account.address,
        subscription: sub,
        signature: '0x1234',
        issuedAt,
      }),
    ).toBe(false);
    expect(await verifySubscribe({ address: 'nope', subscription: sub, signature, issuedAt })).toBe(
      false,
    );
  });
});

describe('payloads', () => {
  it('writes the sale receipt in plain English, one tag per order', () => {
    const p = payloadFor({
      type: 'filled',
      orderId: '7',
      owner: account.address,
      kind: 'floor',
      tokenIn: WMON.address,
      tokenOut: '0x0',
      amountIn: (1_000n * 10n ** 18n).toString(),
      amountOut: '19940040',
      executorFee: '19960',
      priceE18: (2n * 10n ** 16n).toString(),
      txHash: '0xabc',
      latencyMs: 804,
    });
    expect(p).toEqual({
      title: 'Floor hit: sold 1,000 WMON',
      body: 'You got 19.94 USDC at $0.0200 · 0.8 s after the trigger.',
      tag: 'order-7',
      url: '/activity',
    });
    expect(payloadFor({ type: 'selling', orderId: '7', owner: '0x', txHash: '0x' })?.tag).toBe(
      'order-7',
    );
    expect(payloadFor({ type: 'waiting-liquidity', orderId: '7', owner: '0x' })?.url).toBe(
      '/protection/7',
    );
    expect(
      payloadFor({ type: 'unfillable', orderId: '7', owner: '0x', reason: 'balance-or-allowance' })
        ?.title,
    ).toMatch(/can't sell/);
  });
});

describe('notifyOwner', () => {
  it('sends to every device and drops devices the push service says are gone', async () => {
    const store = new MemoryStore();
    const gone = { ...sub, endpoint: 'https://push.example/gone' };
    await store.add(account.address, sub);
    await store.add(account.address, gone);
    const send = vi.fn(async (s: PushSubscription) => {
      if (s.endpoint === gone.endpoint) throw Object.assign(new Error('gone'), { statusCode: 410 });
    });
    const r = await notifyOwner(
      account.address.toUpperCase(),
      { type: 'welcome' },
      { store, send },
    );
    expect(r).toEqual({ sent: 1, removed: 1 });
    expect((await store.list(account.address)).map((s) => s.endpoint)).toEqual([sub.endpoint]);
  });

  it('is a no-op without VAPID keys and never throws', async () => {
    expect(
      await notifyOwner(
        account.address,
        { type: 'welcome' },
        { store: new MemoryStore(), send: null },
      ),
    ).toMatchObject({
      sent: 0,
      skipped: expect.stringMatching(/VAPID/),
    });
    const broken = {
      add: vi.fn(),
      remove: vi.fn(),
      list: vi.fn(async () => Promise.reject(new Error('redis down'))),
    };
    expect(
      await notifyOwner(account.address, { type: 'welcome' }, { store: broken, send: vi.fn() }),
    ).toEqual({ sent: 0, removed: 0 });
  });
});

describe('UpstashStore', () => {
  it('uses one hash per wallet over the REST API', async () => {
    const calls: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const cmd = JSON.parse(String(init.body)) as string[];
      calls.push(cmd);
      return new Response(
        JSON.stringify({ result: cmd[0] === 'HVALS' ? [JSON.stringify(sub)] : 1 }),
      );
    }) as unknown as typeof fetch;
    const s = new UpstashStore('https://redis.example', 'TOKEN', fetchFn);
    await s.add('0xABC', sub);
    expect(await s.list('0xabc')).toEqual([sub]);
    await s.remove('0xAbC', sub.endpoint);
    expect(calls).toEqual([
      ['HSET', 'floor:push:0xabc', sub.endpoint, JSON.stringify(sub)],
      ['HVALS', 'floor:push:0xabc'],
      ['HDEL', 'floor:push:0xabc', sub.endpoint],
    ]);
    const init = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![1];
    expect(init.headers).toMatchObject({ authorization: 'Bearer TOKEN' });
  });
});
