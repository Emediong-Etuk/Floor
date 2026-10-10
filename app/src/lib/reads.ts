'use client';
import { useQuery } from '@tanstack/react-query';
import { erc20Abi, type Address } from 'viem';
import { floorOracleAbi, floorOrdersAbi, OrderStatus } from '@floor/shared';
import { publicClient } from './client';
import { TOKENS, deployment } from './config';

export type Order = Awaited<ReturnType<typeof readOrders>>[number];

/** Live oracle prices for every token (1e18 USD). Polls every 2 s. */
export function usePrices() {
  return useQuery({
    queryKey: ['prices'],
    refetchInterval: 2_000,
    queryFn: async () => {
      const res = await Promise.all(
        TOKENS.map((t) =>
          publicClient.readContract({
            address: deployment.oracle,
            abi: floorOracleAbi,
            functionName: 'getPriceE18',
            args: [t.address],
          }),
        ),
      );
      return new Map(TOKENS.map((t, i) => [t.address.toLowerCase(), res[i]![0]]));
    },
  });
}

/** Token balances, allowances to FloorOrders, and native MON for gas. */
export function useBalances(owner?: Address) {
  return useQuery({
    queryKey: ['balances', owner],
    enabled: !!owner,
    refetchInterval: 3_000,
    queryFn: async () => {
      const o = owner as Address;
      const [native, ...rest] = await Promise.all([
        publicClient.getBalance({ address: o }),
        ...TOKENS.flatMap((t) => [
          publicClient.readContract({
            address: t.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [o],
          }),
          publicClient.readContract({
            address: t.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [o, deployment.floorOrders],
          }),
        ]),
      ]);
      const balances = new Map<string, bigint>();
      const allowances = new Map<string, bigint>();
      TOKENS.forEach((t, i) => {
        balances.set(t.address.toLowerCase(), rest[i * 2]!);
        allowances.set(t.address.toLowerCase(), rest[i * 2 + 1]!);
      });
      return { native, balances, allowances };
    },
  });
}

export async function readOrders(owner: Address) {
  const [ids, orders] = await publicClient.readContract({
    address: deployment.floorOrders,
    abi: floorOrdersAbi,
    functionName: 'getOrdersByOwner',
    args: [owner, 0n, 100n],
  });
  return orders.map((o, i) => ({ ...o, id: ids[i]! }));
}

/** The user's orders, newest first. Polls every 2 s so fills show up within a block or two. */
export function useOrders(owner?: Address) {
  return useQuery({
    queryKey: ['orders', owner],
    enabled: !!owner,
    refetchInterval: 2_000,
    queryFn: () => readOrders(owner as Address),
  });
}

export function useContractParams() {
  return useQuery({
    queryKey: ['params'],
    staleTime: 60_000,
    queryFn: async () => {
      const [executorFeeBps, maxOrderUsdE18] = await Promise.all([
        publicClient.readContract({
          address: deployment.floorOrders,
          abi: floorOrdersAbi,
          functionName: 'executorFeeBps',
        }),
        publicClient.readContract({
          address: deployment.floorOrders,
          abi: floorOrdersAbi,
          functionName: 'maxOrderUsdE18',
        }),
      ]);
      return { executorFeeBps: Number(executorFeeBps), maxOrderUsdE18 };
    },
  });
}

/** A protection as the user sees it: a floor and/or a cash-out, possibly linked (OCO). */
export interface Protection {
  key: string;
  stop?: Order;
  takeProfit?: Order;
  /** The leg that drives status/amount (the stop when present). */
  main: Order;
}

/** Groups bracket legs into one protection. */
export function groupProtections(orders: Order[]): Protection[] {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const seen = new Set<bigint>();
  const out: Protection[] = [];
  for (const o of orders) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const sibling = o.linkedOrderId !== 0n ? byId.get(o.linkedOrderId) : undefined;
    if (sibling) seen.add(sibling.id);
    const legs = [o, sibling].filter((x): x is Order => !!x);
    const stop = legs.find((x) => x.kind === 0);
    const takeProfit = legs.find((x) => x.kind === 1);
    const main = stop ?? takeProfit ?? o;
    out.push({ key: String(main.id), stop, takeProfit, main });
  }
  return out;
}

export const isActive = (p: Protection) =>
  p.main.status === OrderStatus.ACTIVE || p.takeProfit?.status === OrderStatus.ACTIVE;

/**
 * Allowance FloorOrders needs for `token`: the sum of the user's active orders on it, counting
 * a bracket once (only one leg can ever fill).
 */
export function committed(orders: Order[], token: Address): bigint {
  return groupProtections(orders)
    .filter(isActive)
    .filter((p) => p.main.tokenIn.toLowerCase() === token.toLowerCase())
    .reduce((sum, p) => sum + p.main.amountIn, 0n);
}
