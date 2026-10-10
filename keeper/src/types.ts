import type { Address, Hex } from 'viem';

/** FloorOrders.Order plus its id (field names match the contract). */
export interface Order {
  id: bigint;
  owner: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  triggerPriceE18: bigint;
  limitPriceE18: bigint;
  maxSlippageBps: number;
  kind: number;
  status: number;
  expiry: bigint;
  createdAt: bigint;
  linkedOrderId: bigint;
  amountOut: bigint;
  filledAt: bigint;
  fillPriceE18: bigint;
}

/** IFloorOracle.getPriceE18 result. */
export interface PriceSnapshot {
  priceE18: bigint;
  confE18: bigint;
  publishTime: bigint;
}

/** FloorOrders.SwapData */
export interface SwapData {
  target: Address;
  spender: Address;
  data: Hex;
}

/** Per-token and global contract settings the keeper mirrors (refreshed on resync). */
export interface ContractParams {
  decimals: Map<Address, number>;
  maxAge: Map<Address, bigint>;
  maxConfBps: number;
  executorFeeBps: number;
}
