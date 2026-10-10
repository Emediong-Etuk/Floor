import { mockRouterAbi } from '@floor/shared';
import { deployment } from '@/lib/config';
import {
  handle,
  json,
  operator,
  rateLimit,
  requireDemo,
  runSweep,
  serverClient,
} from '@/lib/server';

/**
 * POST { on } opens or closes MockRouter's "liquidity gap" (pays 3% under the oracle), so the
 * demo can show FloorOrders refusing a bad fill. Closing it runs a keeper pass.
 */
export function POST(req: Request) {
  return handle(async () => {
    requireDemo();
    rateLimit('gap', 1_500);
    const { on } = (await req.json()) as { on?: boolean };
    const hash = await operator().writeContract({
      address: deployment.swapTarget,
      abi: mockRouterAbi,
      functionName: 'setLiquidityGap',
      args: [Boolean(on), on ? 300 : 0],
    });
    await serverClient.waitForTransactionReceipt({ hash });
    const sweep = on ? null : await runSweep().catch((err: unknown) => ({ error: String(err) }));
    return json({ on: Boolean(on), txHash: hash, sweep });
  });
}

export async function GET() {
  return handle(async () => {
    const on = await serverClient.readContract({
      address: deployment.swapTarget,
      abi: mockRouterAbi,
      functionName: 'liquidityGap',
    });
    return json({ on });
  });
}
