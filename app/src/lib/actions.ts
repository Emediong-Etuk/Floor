import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import { floorOrdersAbi } from '@floor/shared';
import { publicClient } from './client';
import { deployment } from './config';
import type { TxRequest } from './wallet';

/**
 * Transaction builders. Each simulates first (as the user), so a revert shows a readable
 * contract error instead of a failed signature.
 */
async function build(
  account: Address,
  to: Address,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
): Promise<TxRequest> {
  await publicClient.simulateContract({
    account,
    address: to,
    abi: abi as never,
    functionName: functionName as never,
    args: args as never,
  });
  const data = encodeFunctionData({ abi, functionName, args } as Parameters<
    typeof encodeFunctionData
  >[0]);
  return { to, data };
}

export const approve = (account: Address, token: Address, amount: bigint) =>
  build(account, token, erc20Abi, 'approve', [deployment.floorOrders, amount]);

export interface ProtectInput {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  floorE18: bigint;
  cashOutE18?: bigint;
  limitE18: bigint;
  slippageBps: number;
  expiry: bigint;
}

export function createProtection(account: Address, p: ProtectInput) {
  if (p.cashOutE18) {
    return build(account, deployment.floorOrders, floorOrdersAbi, 'createBracket', [
      p.tokenIn,
      p.tokenOut,
      p.amountIn,
      p.floorE18,
      p.cashOutE18,
      p.limitE18,
      p.slippageBps,
      p.expiry,
    ]);
  }
  return build(account, deployment.floorOrders, floorOrdersAbi, 'createOrder', [
    {
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      amountIn: p.amountIn,
      triggerPriceE18: p.floorE18,
      limitPriceE18: p.limitE18,
      maxSlippageBps: p.slippageBps,
      kind: 0,
      expiry: p.expiry,
    },
  ]);
}

export const updateOrder = (
  account: Address,
  id: bigint,
  trigger: bigint,
  limit: bigint,
  slippageBps: number,
  expiry: bigint,
) =>
  build(account, deployment.floorOrders, floorOrdersAbi, 'updateOrder', [
    id,
    trigger,
    limit,
    slippageBps,
    expiry,
  ]);

export const cancelOrder = (account: Address, id: bigint) =>
  build(account, deployment.floorOrders, floorOrdersAbi, 'cancelOrder', [id]);

/** Ask the server to run one keeper pass right away (demo mode, D-011). Fire and forget. */
export function pokeKeeper(): void {
  void fetch('/api/keeper/sweep', { method: 'POST' }).catch(() => undefined);
}
