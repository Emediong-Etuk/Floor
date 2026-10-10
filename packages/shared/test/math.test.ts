import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OrderKind,
  convert,
  executorFee,
  isConfident,
  isExpired,
  isFresh,
  isTriggered,
  lessBps,
  minOut,
} from '../src/index.ts';

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./vectors/min-out.json', import.meta.url)), 'utf8'),
) as Record<string, string[]>;
const col = (k: string) => {
  const v = vectors[k];
  if (!v) throw new Error(`missing column ${k}`);
  return v;
};

describe('minOut parity with FloorMath (shared vectors)', () => {
  it('matches every vector', () => {
    const n = col('amountIn').length;
    expect(n).toBeGreaterThan(100);
    for (let i = 0; i < n; i++) {
      const got = minOut(
        BigInt(col('amountIn')[i]!),
        Number(col('decIn')[i]),
        Number(col('decOut')[i]),
        BigInt(col('priceIn')[i]!),
        BigInt(col('priceOut')[i]!),
        Number(col('slippageBps')[i]),
      );
      expect(got, `vector ${i}`).toBe(BigInt(col('minOut')[i]!));
    }
  });

  it('reproduces the contract test examples', () => {
    // 1,000 WMON at $0.029 → 29 USDC; 1% slippage → 28.71
    expect(convert(1_000n * 10n ** 18n, 18, 6, 29n * 10n ** 15n, 10n ** 18n)).toBe(29_000_000n);
    expect(minOut(1_000n * 10n ** 18n, 18, 6, 29n * 10n ** 15n, 10n ** 18n, 100)).toBe(28_710_000n);
    expect(lessBps(29_000_000n, 20)).toBe(28_942_000n); // MockRouter 0.2% spread
    expect(executorFee(28_942_000n, 10)).toBe(28_942n);
  });
});

describe('trigger, expiry, freshness, confidence rules', () => {
  const floor = 30n * 10n ** 15n;
  it('stop-loss fires at and below the floor, not above', () => {
    expect(isTriggered(OrderKind.STOP_LOSS, floor + 1n, floor, 0n)).toBe(false);
    expect(isTriggered(OrderKind.STOP_LOSS, floor, floor, 0n)).toBe(true);
    expect(isTriggered(OrderKind.STOP_LOSS, 1n, floor, 0n)).toBe(true);
  });
  it('stop-limit holds below the limit', () => {
    const limit = 25n * 10n ** 15n;
    expect(isTriggered(OrderKind.STOP_LOSS, limit - 1n, floor, limit)).toBe(false);
    expect(isTriggered(OrderKind.STOP_LOSS, limit, floor, limit)).toBe(true);
  });
  it('take-profit fires at and above', () => {
    expect(isTriggered(OrderKind.TAKE_PROFIT, floor - 1n, floor, 0n)).toBe(false);
    expect(isTriggered(OrderKind.TAKE_PROFIT, floor, floor, 0n)).toBe(true);
  });
  it('expiry, freshness and confidence match the contract', () => {
    expect(isExpired(0n, 10n ** 12n)).toBe(false);
    expect(isExpired(100n, 99n)).toBe(false);
    expect(isExpired(100n, 100n)).toBe(true);
    expect(isFresh(100n, 115n, 15n)).toBe(true);
    expect(isFresh(100n, 116n, 15n)).toBe(false);
    expect(isFresh(120n, 115n, 15n)).toBe(true); // future publish time = age 0
    expect(isConfident(29n * 10n ** 13n, 29n * 10n ** 15n, 100)).toBe(true); // exactly 1%
    expect(isConfident(30n * 10n ** 13n, 29n * 10n ** 15n, 100)).toBe(false);
  });
});
