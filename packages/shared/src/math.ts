/**
 * Exact TypeScript mirror of contracts/src/libraries/FloorMath.sol and FloorOrders' trigger
 * rule. All amounts and prices are bigint (prices are USD × 1e18). OpenZeppelin's
 * Math.mulDiv(a, b, c) is floor(a·b / c) computed without overflow; bigint division already
 * floors for non-negative values, so `a * b / c` is the same number.
 *
 * Parity is checked against test/vectors/min-out.json, which the Foundry suite
 * (contracts/test/Vectors.t.sol) checks too.
 */
export const BPS = 10_000n;

export const OrderKind = { STOP_LOSS: 0, TAKE_PROFIT: 1 } as const;
export type OrderKind = (typeof OrderKind)[keyof typeof OrderKind];

export const OrderStatus = { NONE: 0, ACTIVE: 1, FILLED: 2, CANCELLED: 3, EXPIRED: 4 } as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** How much tokenOut `amountIn` of tokenIn is worth at the given USD prices (FloorMath.convert). */
export function convert(
  amountIn: bigint,
  decIn: number,
  decOut: number,
  priceIn: bigint,
  priceOut: bigint,
): bigint {
  if (decOut >= decIn) return (amountIn * 10n ** BigInt(decOut - decIn) * priceIn) / priceOut;
  return (amountIn * priceIn) / (priceOut * 10n ** BigInt(decIn - decOut));
}

/** `amount` reduced by `bps` basis points, rounded down (FloorMath.lessBps). */
export function lessBps(amount: bigint, bps: number | bigint): bigint {
  return (amount * (BPS - BigInt(bps))) / BPS;
}

/** The least output `execute` accepts (FloorMath.minOut). */
export function minOut(
  amountIn: bigint,
  decIn: number,
  decOut: number,
  priceIn: bigint,
  priceOut: bigint,
  slippageBps: number | bigint,
): bigint {
  return lessBps(convert(amountIn, decIn, decOut, priceIn, priceOut), slippageBps);
}

/** FloorOrders._triggered: stop-loss at/below the floor (and at/above any stop-limit); take-profit at/above. */
export function isTriggered(
  kind: OrderKind,
  price: bigint,
  triggerPriceE18: bigint,
  limitPriceE18: bigint,
): boolean {
  if (kind === OrderKind.STOP_LOSS) {
    return price <= triggerPriceE18 && (limitPriceE18 === 0n || price >= limitPriceE18);
  }
  return price >= triggerPriceE18;
}

/** Executor fee taken from the venue output (FloorOrders.execute step 11). */
export function executorFee(received: bigint, feeBps: number | bigint): bigint {
  return (received * BigInt(feeBps)) / BPS;
}

/** FloorOrders._isExpired. `now` is unix seconds. */
export function isExpired(expiry: bigint, now: bigint): boolean {
  return expiry !== 0n && now >= expiry;
}

/** FloorOrders._checkedPrice freshness rule; a publish time ahead of `now` counts as age 0. */
export function isFresh(publishTime: bigint, now: bigint, maxAge: bigint): boolean {
  return publishTime >= now || now - publishTime <= maxAge;
}

/** FloorOrders._checkedPrice confidence rule: conf / price <= maxConfBps. */
export function isConfident(conf: bigint, price: bigint, maxConfBps: number | bigint): boolean {
  return conf * BPS <= BigInt(maxConfBps) * price;
}
