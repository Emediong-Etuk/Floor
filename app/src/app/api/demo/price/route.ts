import { mockOracleAbi } from '@floor/shared';
import { deployment, tokenBySymbol } from '@/lib/config';
import {
  HttpError,
  handle,
  json,
  operator,
  rateLimit,
  requireDemo,
  runSweep,
  serverClient,
} from '@/lib/server';

// Seed prices used by DeployDemo (contracts/script/DeployDemo.s.sol), for the Reset button.
const SEED: Record<string, bigint> = {
  WMON: 25n * 10n ** 15n,
  WETH: 2_500n * 10n ** 18n,
  cbBTC: 83_000n * 10n ** 18n,
  USDC: 10n ** 18n,
};

/**
 * POST { symbol, bps } moves the MockOracle price by bps (−2000 = −20%), or { symbol, reset: true }.
 * Then runs one keeper pass, so any protection whose floor was crossed sells right away.
 */
export function POST(req: Request) {
  return handle(async () => {
    requireDemo();
    rateLimit('price', 1_500);
    const body = (await req.json()) as { symbol?: string; bps?: number; reset?: boolean };
    const token = tokenBySymbol(body.symbol ?? 'WMON');
    if (!token) throw new HttpError(400, 'Unknown token.');
    const [current] = await serverClient.readContract({
      address: deployment.oracle,
      abi: mockOracleAbi,
      functionName: 'getPriceE18',
      args: [token.address],
    });
    let next: bigint;
    if (body.reset) {
      next = SEED[token.symbol] ?? current;
    } else {
      const bps = Number(body.bps);
      if (!Number.isFinite(bps) || bps <= -9_900 || bps > 100_000)
        throw new HttpError(400, 'Pick a change between −99% and +1000%.');
      next = (current * BigInt(10_000 + Math.round(bps))) / 10_000n;
    }
    const w = operator();
    const hash = await w.writeContract({
      address: deployment.oracle,
      abi: mockOracleAbi,
      functionName: 'setPrice',
      args: [token.address, next],
    });
    const receipt = await serverClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new HttpError(502, 'Price update failed on-chain.');
    const sweep = await runSweep().catch((err: unknown) => ({ error: String(err) }));
    return json({
      symbol: token.symbol,
      previousE18: current,
      priceE18: next,
      txHash: hash,
      sweep,
    });
  });
}
