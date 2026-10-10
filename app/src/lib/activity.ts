import { parseAbiItem, type Hex } from 'viem';
import { publicClient } from './client';
import { deployment } from './config';

const FILLED = parseAbiItem(
  'event OrderFilled(uint256 indexed id, address indexed owner, address indexed executor, uint256 priceE18, uint256 amountIn, uint256 amountOut, uint256 executorFee)',
);

/** Latest block at or before `ts` (binary search: ~25 header reads, no archive needed). */
async function blockAt(ts: bigint): Promise<bigint> {
  let hi = await publicClient.getBlockNumber();
  let lo = hi > 5_000_000n ? hi - 5_000_000n : 0n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const b = await publicClient.getBlock({ blockNumber: mid });
    if (b.timestamp <= ts) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

const cache = new Map<string, Hex | null>();

/**
 * The fill tx isn't stored on-chain, only `filledAt`. Find it from the OrderFilled event in
 * the few blocks around that timestamp (Monad blocks are ~0.4 s, so several share a second).
 */
export async function findFillTx(id: bigint, filledAt: bigint): Promise<Hex | null> {
  const key = `${deployment.floorOrders}:${id}`;
  if (cache.has(key)) return cache.get(key)!;
  try {
    const end = await blockAt(filledAt);
    const logs = await publicClient.getLogs({
      address: deployment.floorOrders,
      event: FILLED,
      args: { id },
      fromBlock: end > 10n ? end - 10n : 0n,
      toBlock: end + 10n,
    });
    const hash = logs[0]?.transactionHash ?? null;
    cache.set(key, hash);
    return hash;
  } catch {
    return null;
  }
}
