import type { Address } from 'viem';
import {
  isConfident,
  isExpired,
  isFresh,
  isTriggered,
  minOut,
  type OrderKind,
} from '@floor/shared';
import type { ContractParams, Order, PriceSnapshot } from './types.ts';

export interface Candidate {
  order: Order;
  priceIn: PriceSnapshot;
  priceOut: PriceSnapshot;
  minOut: bigint;
}

export interface Evaluation {
  /** Triggered with usable prices: try to execute. */
  triggered: Candidate[];
  /** Past expiry: call expire(). */
  expired: Order[];
  /** Triggered by price, but the price is too stale/uncertain for execute to accept. */
  blocked: { order: Order; reason: 'stale' | 'uncertain' }[];
  /** Ids whose price is not (or no longer) at the trigger. */
  untriggered: bigint[];
}

/**
 * Same decisions `execute` makes, done off-chain each block so the keeper only sends
 * transactions that will succeed. Pure: easy to test, no I/O.
 */
export function evaluate(
  orders: Iterable<Order>,
  prices: Map<Address, PriceSnapshot>,
  params: ContractParams,
  now: bigint,
): Evaluation {
  const out: Evaluation = { triggered: [], expired: [], blocked: [], untriggered: [] };
  for (const order of orders) {
    if (isExpired(order.expiry, now)) {
      out.expired.push(order);
      continue;
    }
    const pIn = prices.get(order.tokenIn);
    const pOut = prices.get(order.tokenOut);
    const decIn = params.decimals.get(order.tokenIn);
    const decOut = params.decimals.get(order.tokenOut);
    if (!pIn || !pOut || decIn === undefined || decOut === undefined) continue;

    if (
      !isTriggered(
        order.kind as OrderKind,
        pIn.priceE18,
        order.triggerPriceE18,
        order.limitPriceE18,
      )
    ) {
      out.untriggered.push(order.id);
      continue;
    }
    const usable = (token: Address, p: PriceSnapshot) =>
      isFresh(p.publishTime, now, params.maxAge.get(token) ?? 15n)
        ? isConfident(p.confE18, p.priceE18, params.maxConfBps)
          ? undefined
          : ('uncertain' as const)
        : ('stale' as const);
    const problem = usable(order.tokenIn, pIn) ?? usable(order.tokenOut, pOut);
    if (problem) {
      out.blocked.push({ order, reason: problem });
      continue;
    }
    out.triggered.push({
      order,
      priceIn: pIn,
      priceOut: pOut,
      minOut: minOut(
        order.amountIn,
        decIn,
        decOut,
        pIn.priceE18,
        pOut.priceE18,
        order.maxSlippageBps,
      ),
    });
  }
  return out;
}
