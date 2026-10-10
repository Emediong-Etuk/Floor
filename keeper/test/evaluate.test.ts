import { describe, expect, it } from 'vitest';
import { OrderKind } from '@floor/shared';
import { evaluate } from '../src/evaluate.ts';
import { USDC, WMON, e18, order, params, prices } from './helpers.ts';

describe('evaluate', () => {
  it('triggers a stop-loss at the floor with the contract minOut', () => {
    const ev = evaluate([order()], prices(0.029), params, 1_000n);
    expect(ev.triggered).toHaveLength(1);
    expect(ev.triggered[0]!.minOut).toBe(28_710_000n); // 29 USDC less 1%
    expect(evaluate([order()], prices(0.031), params, 1_000n).untriggered).toEqual([1n]);
  });

  it('handles take-profit and stop-limit', () => {
    const tp = order({ kind: OrderKind.TAKE_PROFIT, triggerPriceE18: e18(0.04) });
    expect(evaluate([tp], prices(0.04), params, 1_000n).triggered).toHaveLength(1);
    const limited = order({ limitPriceE18: e18(0.025) });
    expect(evaluate([limited], prices(0.024), params, 1_000n).untriggered).toEqual([1n]);
  });

  it('sends expired orders to the expiry queue before anything else', () => {
    const ev = evaluate([order({ expiry: 900n })], prices(0.01), params, 1_000n);
    expect(ev.expired.map((o) => o.id)).toEqual([1n]);
    expect(ev.triggered).toHaveLength(0);
  });

  it('blocks stale or uncertain prices that execute would reject', () => {
    expect(evaluate([order()], prices(0.029, 984n), params, 1_000n).blocked[0]?.reason).toBe(
      'stale',
    );
    const p = prices(0.029);
    p.set(WMON, { priceE18: e18(0.029), confE18: e18(0.001), publishTime: 1_000n }); // 3.4%
    expect(evaluate([order()], p, params, 1_000n).blocked[0]?.reason).toBe('uncertain');
    // Stale tokenOut (USDC) blocks too.
    const q = prices(0.029);
    q.set(USDC, { priceE18: e18(1), confE18: 0n, publishTime: 1n });
    expect(evaluate([order()], q, params, 1_000n).blocked[0]?.reason).toBe('stale');
  });

  it('skips orders with missing prices or unknown decimals', () => {
    const p = prices(0.029);
    p.delete(USDC);
    const ev = evaluate([order()], p, params, 1_000n);
    expect(ev.triggered.length + ev.untriggered.length + ev.blocked.length).toBe(0);
  });
});
