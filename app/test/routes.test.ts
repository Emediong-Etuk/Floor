import { beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { POST as subscribe } from '@/app/api/push/subscribe/route';
import { POST as notify } from '@/app/api/notify/route';
import { getStore } from '@/lib/push';
import { subscribeMessage } from '@/lib/push-message';

const account = privateKeyToAccount(`0x${'33'.repeat(32)}`);
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/route-test',
  keys: { p256dh: 'k', auth: 'a' },
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/push/subscribe', () => {
  it('stores a correctly signed subscription and rejects a forged one', async () => {
    const issuedAt = new Date().toISOString();
    const signature = await account.signMessage({
      message: await subscribeMessage(account.address, subscription.endpoint, issuedAt),
    });
    const ok = await subscribe(
      post({ address: account.address, subscription, signature, issuedAt }),
    );
    expect(ok.status).toBe(200);
    expect(await getStore().list(account.address)).toEqual([subscription]);

    const forger = privateKeyToAccount(`0x${'44'.repeat(32)}`);
    const forged = await forger.signMessage({
      message: await subscribeMessage(account.address, subscription.endpoint, issuedAt),
    });
    await new Promise((r) => setTimeout(r, 2_100)); // per-wallet rate limit
    const bad = await subscribe(
      post({ address: account.address, subscription, signature: forged, issuedAt }),
    );
    expect(bad.status).toBe(401);
    expect((await subscribe(post({ address: account.address }))).status).toBe(400);
  });
});

describe('POST /api/notify', () => {
  beforeEach(() => {
    process.env.NOTIFY_SECRET = 'test-secret';
  });
  it('requires the shared secret and a known event', async () => {
    const ev = { type: 'waiting-liquidity', orderId: '1', owner: account.address };
    expect((await notify(post(ev))).status).toBe(401);
    expect((await notify(post(ev, { authorization: 'Bearer wrong' }))).status).toBe(401);
    expect(
      (await notify(post({ type: 'nope', owner: '0x' }, { authorization: 'Bearer test-secret' })))
        .status,
    ).toBe(400);
    const r = await notify(post(ev, { authorization: 'Bearer test-secret' }));
    expect(r.status).toBe(200);
    // No VAPID keys in tests: delivery is skipped, not failed.
    expect(await r.json()).toMatchObject({ skipped: expect.stringMatching(/VAPID/) });
  });
});
