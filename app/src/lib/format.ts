import { formatUnits } from 'viem';

/** USD from a 1e18-scaled value: more decimals for small prices ($0.0225 vs $2,500.00). */
export function usd(e18: bigint, opts: { sign?: boolean } = {}): string {
  const n = Number(formatUnits(e18 < 0n ? -e18 : e18, 18));
  const digits = n === 0 ? 2 : n < 0.01 ? 6 : n < 1 ? 4 : 2;
  const s = n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${e18 < 0n ? '−' : opts.sign ? '+' : ''}$${s}`;
}

/** Token amount with sensible precision. */
export function amount(value: bigint, decimals: number, maxFrac = 4): string {
  const n = Number(formatUnits(value, decimals));
  const frac = n >= 1000 ? 2 : n >= 1 ? Math.min(maxFrac, 4) : maxFrac + 2;
  return n.toLocaleString('en-US', { maximumFractionDigits: frac });
}

/** Signed percentage, e.g. −10% / +20%. */
export function pct(p: number, digits = 0): string {
  const s = Math.abs(p).toFixed(digits);
  return `${p < 0 ? '−' : p > 0 ? '+' : ''}${s}%`;
}

/** Percentage change between two 1e18 prices. */
export function change(from: bigint, to: bigint): number {
  if (from === 0n) return 0;
  return Number(((to - from) * 1_000_000n) / from) / 10_000;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** USD value (1e18) of a token amount at a 1e18 price. */
export function usdValue(value: bigint, decimals: number, priceE18: bigint): bigint {
  return (value * priceE18) / 10n ** BigInt(decimals);
}

/** Price × multiplier in basis points, e.g. 9_000 = −10%. */
export function scalePrice(priceE18: bigint, bps: number): bigint {
  return (priceE18 * BigInt(Math.round(bps))) / 10_000n;
}

export function timeAgo(unixSeconds: bigint): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}
