import type { Hex } from 'viem';

/**
 * Pyth price helpers. Mirrors PythAdapter.toE18 so the keeper reads Hermes prices on exactly
 * the scale the contract uses. Hermes API: https://docs.pyth.network/price-feeds/core/fetch-price-updates
 */
export class InvalidExpoError extends Error {}

/** value × 10^expo → value × 10^18, truncating (PythAdapter.toE18). */
export function pythToE18(value: bigint, expo: number): bigint {
  if (expo < -58 || expo > 18) throw new InvalidExpoError(`expo ${expo} out of range`);
  const shift = expo + 18;
  return shift >= 0 ? value * 10n ** BigInt(shift) : value / 10n ** BigInt(-shift);
}

export interface PythPrice {
  /** 0x-prefixed lowercase feed id */
  feedId: Hex;
  priceE18: bigint;
  confE18: bigint;
  publishTime: bigint;
}

/** Shape of GET {hermes}/v2/updates/price/latest?ids[]=...&encoding=hex */
export interface HermesLatestResponse {
  binary: { encoding: string; data: string[] };
  parsed: {
    id: string;
    price: { price: string; conf: string; expo: number; publish_time: number };
  }[];
}

/** Parses a Hermes response into update bytes for `execute` and e18 prices for trigger checks. */
export function parseHermes(res: HermesLatestResponse): { updateData: Hex[]; prices: PythPrice[] } {
  if (res.binary.encoding !== 'hex') throw new Error(`unexpected encoding ${res.binary.encoding}`);
  const updateData = res.binary.data.map((d) => (d.startsWith('0x') ? d : `0x${d}`) as Hex);
  const prices: PythPrice[] = [];
  for (const p of res.parsed) {
    const raw = BigInt(p.price.price);
    // Same rule as the adapter: non-positive prices are unusable.
    if (raw <= 0n) continue;
    prices.push({
      feedId: (p.id.startsWith('0x') ? p.id : `0x${p.id}`).toLowerCase() as Hex,
      priceE18: pythToE18(raw, p.price.expo),
      confE18: pythToE18(BigInt(p.price.conf), p.price.expo),
      publishTime: BigInt(p.price.publish_time),
    });
  }
  return { updateData, prices };
}
