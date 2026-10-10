import { pino } from 'pino';
import type { Address, Hex } from 'viem';
import { OrderKind, OrderStatus } from '@floor/shared';
import type { ContractParams, Order, PriceSnapshot } from '../src/types.ts';

export const silent = pino({ level: 'silent' });
export const WMON = '0x00000000000000000000000000000000000000a1' as Address;
export const USDC = '0x00000000000000000000000000000000000000b2' as Address;
export const OWNER = '0x00000000000000000000000000000000000000c3' as Address;
export const e18 = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

export function order(over: Partial<Order> = {}): Order {
  return {
    id: 1n,
    owner: OWNER,
    tokenIn: WMON,
    tokenOut: USDC,
    amountIn: 1_000n * 10n ** 18n,
    triggerPriceE18: e18(0.03),
    limitPriceE18: 0n,
    maxSlippageBps: 100,
    kind: OrderKind.STOP_LOSS,
    status: OrderStatus.ACTIVE,
    expiry: 0n,
    createdAt: 1n,
    linkedOrderId: 0n,
    amountOut: 0n,
    filledAt: 0n,
    fillPriceE18: 0n,
    ...over,
  };
}

export const params: ContractParams = {
  decimals: new Map([
    [WMON, 18],
    [USDC, 6],
  ]),
  maxAge: new Map([
    [WMON, 15n],
    [USDC, 15n],
  ]),
  maxConfBps: 100,
  executorFeeBps: 10,
};

export function prices(mon: number, publishTime = 1_000n, usdc = 1): Map<Address, PriceSnapshot> {
  return new Map([
    [WMON, { priceE18: e18(mon), confE18: 0n, publishTime }],
    [USDC, { priceE18: e18(usdc), confE18: 0n, publishTime }],
  ]);
}

export const HASH = `0x${'ab'.repeat(32)}` as Hex;
