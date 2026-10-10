import type { Abi } from 'viem';
import { toFunctionSelector } from 'viem';
import { floorOrdersAbi, mockErc20Abi, mockRouterAbi, pythAdapterAbi } from '@floor/shared';

/**
 * FloorOrders' ABI plus the custom errors that can bubble up through `execute` from the
 * oracle adapter, the demo router and OpenZeppelin's ERC-20, so viem can decode any revert
 * by name. Errors are de-duplicated by selector (e.g. InsufficientOutput exists twice).
 */
type AbiError = Extract<Abi[number], { type: 'error' }>;

function withErrorsFrom(base: Abi, ...others: Abi[]): Abi {
  const seen = new Set<string>();
  const sig = (e: AbiError) =>
    toFunctionSelector(`${e.name}(${e.inputs.map((i: { type: string }) => i.type).join(',')})`);
  for (const item of base) if (item.type === 'error') seen.add(sig(item));
  const extra: AbiError[] = [];
  for (const abi of others) {
    for (const item of abi) {
      if (item.type !== 'error') continue;
      const s = sig(item);
      if (seen.has(s)) continue;
      seen.add(s);
      extra.push(item);
    }
  }
  return [...base, ...extra];
}

export const executeAbi = withErrorsFrom(
  floorOrdersAbi,
  pythAdapterAbi,
  mockRouterAbi,
  mockErc20Abi,
);
