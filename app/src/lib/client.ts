import { createPublicClient, http } from 'viem';
import { RPC_URL, chain } from './config';

/** Browser read client. Multicall3 batches reads on Monad; anvil has none, so it's off there. */
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { retryCount: 2 }),
  batch: chain.contracts?.multicall3 ? { multicall: true } : undefined,
  pollingInterval: 400,
});
