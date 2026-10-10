import { describe, expect, it } from 'vitest';
import { InvalidExpoError, parseHermes, pythToE18 } from '../src/index.ts';

describe('pythToE18 (mirrors PythAdapter.toE18)', () => {
  it('converts across expos', () => {
    expect(pythToE18(3_300_000n, -8)).toBe(33n * 10n ** 15n);
    expect(pythToE18(5n, 0)).toBe(5n * 10n ** 18n);
    expect(pythToE18(5n, 2)).toBe(500n * 10n ** 18n);
    expect(pythToE18(123_456_789n, -20)).toBe(1_234_567n);
  });
  it('rejects out-of-range expos like the adapter', () => {
    expect(() => pythToE18(1n, 19)).toThrow(InvalidExpoError);
    expect(() => pythToE18(1n, -59)).toThrow(InvalidExpoError);
  });
});

describe('parseHermes', () => {
  it('extracts hex update data and e18 prices, dropping non-positive prices', () => {
    const { updateData, prices } = parseHermes({
      binary: { encoding: 'hex', data: ['504e4155', '0xdeadbeef'] },
      parsed: [
        {
          id: '31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
          price: { price: '2475195', conf: '885', expo: -8, publish_time: 1_791_630_000 },
        },
        { id: 'aa'.repeat(32), price: { price: '-1', conf: '0', expo: -8, publish_time: 1 } },
      ],
    });
    expect(updateData).toEqual(['0x504e4155', '0xdeadbeef']);
    expect(prices).toEqual([
      {
        feedId: '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
        priceE18: 24_751_950_000_000_000n,
        confE18: 8_850_000_000_000n,
        publishTime: 1_791_630_000n,
      },
    ]);
  });
  it('rejects non-hex encodings', () => {
    expect(() => parseHermes({ binary: { encoding: 'base64', data: [] }, parsed: [] })).toThrow();
  });
});
