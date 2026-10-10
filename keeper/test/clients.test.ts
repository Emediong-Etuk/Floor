import { describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { HermesClient } from '../src/hermes.ts';
import { Notifier } from '../src/notifier.ts';
import { HermesUpdates, ZeroExVenue } from '../src/venues.ts';
import { QuoteError, ZeroExClient } from '../src/zeroex.ts';
import { OWNER, USDC, WMON, e18, order, silent } from './helpers.ts';

const AH = '0x0000000000001fF3684f28c67538d4D072C22734' as Address;
const FLOOR = '0x00000000000000000000000000000000000000f1' as Address;
const KEEPER = '0x00000000000000000000000000000000000000e1' as Address;

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const goodQuote = {
  liquidityAvailable: true,
  buyAmount: '29000000',
  minBuyAmount: '28710000',
  transaction: { to: AH, data: '0xdeadbeef', value: '0' },
  issues: { allowance: { spender: AH, actual: '0' } },
};

describe('ZeroExClient + ZeroExVenue', () => {
  it('requests an AllowanceHolder quote with FloorOrders as taker and the keeper as txOrigin', async () => {
    const f = json(goodQuote);
    const q = await new ZeroExClient('https://api.0x.org', 'KEY', AH, f).quote({
      chainId: 143,
      sellToken: WMON,
      buyToken: USDC,
      sellAmount: 10n ** 21n,
      taker: FLOOR,
      txOrigin: KEEPER,
      slippageBps: 100,
    });
    expect(q?.buyAmount).toBe(29_000_000n);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    const u = new URL(url);
    expect(u.pathname).toBe('/swap/allowance-holder/quote');
    expect(u.searchParams.get('taker')).toBe(FLOOR);
    expect(u.searchParams.get('txOrigin')).toBe(KEEPER);
    expect(u.searchParams.get('chainId')).toBe('143');
    expect(init.headers).toMatchObject({ '0x-api-key': 'KEY', '0x-version': 'v2' });
  });

  it('refuses quotes that would call anything but AllowanceHolder, or send value', async () => {
    const evil = { ...goodQuote, transaction: { ...goodQuote.transaction, to: WMON } };
    const c = new ZeroExClient('https://api.0x.org', 'KEY', AH, json(evil));
    await expect(
      c.quote({
        chainId: 143,
        sellToken: WMON,
        buyToken: USDC,
        sellAmount: 1n,
        taker: FLOOR,
        txOrigin: KEEPER,
        slippageBps: 100,
      }),
    ).rejects.toThrow(QuoteError);
    const valued = { ...goodQuote, transaction: { ...goodQuote.transaction, value: '1' } };
    const c2 = new ZeroExClient('https://api.0x.org', 'KEY', AH, json(valued));
    await expect(
      c2.quote({
        chainId: 143,
        sellToken: WMON,
        buyToken: USDC,
        sellAmount: 1n,
        taker: FLOOR,
        txOrigin: KEEPER,
        slippageBps: 100,
      }),
    ).rejects.toThrow(/native value/);
  });

  it('waits when the quote is below minOut or there is no liquidity', async () => {
    const venue = (body: unknown) =>
      new ZeroExVenue(new ZeroExClient('https://x', 'k', AH, json(body)), 143, FLOOR, KEEPER);
    expect(await venue(goodQuote).build(order(), 29_000_001n)).toEqual({ wait: 'liquidity' });
    expect(await venue({ liquidityAvailable: false }).build(order(), 1n)).toEqual({
      wait: 'liquidity',
    });
    expect(await venue(goodQuote).build(order(), 28_710_000n)).toEqual({
      swap: { target: AH, spender: AH, data: '0xdeadbeef' },
    });
  });
});

describe('HermesUpdates', () => {
  const MON_FEED = `0x${'31'.repeat(32)}` as const;
  const USDC_FEED = `0x${'ea'.repeat(32)}` as const;
  const hermesBody = {
    binary: { encoding: 'hex', data: ['504e4155'] },
    parsed: [
      {
        id: '31'.repeat(32),
        price: { price: '2900000', conf: '0', expo: -8, publish_time: 2_000 },
      },
      {
        id: 'ea'.repeat(32),
        price: { price: '100000000', conf: '0', expo: -8, publish_time: 2_000 },
      },
    ],
  };

  it('overlays only fresher prices, sends a bearer key, caches between blocks', async () => {
    const f = json(hermesBody);
    let t = 0;
    const u = new HermesUpdates(
      new HermesClient('https://pyth.dourolabs.app/hermes', 'PKEY', f),
      async (token) => (token === WMON ? MON_FEED : USDC_FEED),
      1_000,
      () => t,
    );
    const p = new Map([[WMON, { priceE18: e18(0.03), confE18: 0n, publishTime: 1_000n }]]);
    await u.overlay(p, [WMON, USDC]);
    expect(p.get(WMON)?.priceE18).toBe(e18(0.029));
    expect(p.get(USDC)?.priceE18).toBe(e18(1));
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toContain('/v2/updates/price/latest?');
    expect(init.headers).toMatchObject({ authorization: 'Bearer PKEY' });

    t = 500;
    await u.overlay(p, [WMON, USDC]); // cached
    expect(f).toHaveBeenCalledTimes(1);
    expect(await u.updateData([WMON, USDC])).toEqual(['0x504e4155']); // always fresh for a fill
    expect(f).toHaveBeenCalledTimes(2);

    const newer = new Map([[WMON, { priceE18: e18(0.05), confE18: 0n, publishTime: 3_000n }]]);
    t = 5_000;
    await u.overlay(newer, [WMON]);
    expect(newer.get(WMON)?.priceE18).toBe(e18(0.05)); // on-chain price is newer: kept
  });
});

describe('Notifier', () => {
  it('posts with the shared secret, once per key until reset', async () => {
    const f = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const n = new Notifier('https://app.example/api/notify', 'S3CRET', silent, f);
    const ev = { type: 'waiting-liquidity', orderId: '1', owner: OWNER } as const;
    n.once('liquidity:1', ev);
    n.once('liquidity:1', ev);
    expect(f).toHaveBeenCalledTimes(1);
    n.reset('liquidity:1');
    n.once('liquidity:1', ev);
    expect(f).toHaveBeenCalledTimes(2);
    const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect(init.headers).toMatchObject({ authorization: 'Bearer S3CRET' });
  });

  it('is a no-op without a URL', () => {
    const f = vi.fn() as unknown as typeof fetch;
    new Notifier(undefined, undefined, silent, f).send({
      type: 'waiting-liquidity',
      orderId: '1',
      owner: OWNER,
    });
    expect(f).not.toHaveBeenCalled();
  });
});
