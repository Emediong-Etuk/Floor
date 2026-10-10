import { isAddress, parseEther, parseUnits, type Address } from 'viem';
import { mockErc20Abi } from '@floor/shared';
import { tokenBySymbol } from '@/lib/config';
import {
  HttpError,
  handle,
  json,
  operator,
  rateLimit,
  requireDemo,
  serverClient,
} from '@/lib/server';

const DRIP_MON = parseEther(process.env.FAUCET_MON ?? '0.2');
const LOW = parseEther('0.05');

/**
 * POST { address }: demo onboarding in one tap. Sends a little test MON for fees (only if the
 * wallet is low) and mints demo WMON + WETH, so a judge can protect something immediately.
 */
export function POST(req: Request) {
  return handle(async () => {
    requireDemo();
    const { address } = (await req.json()) as { address?: string };
    if (!address || !isAddress(address)) throw new HttpError(400, 'Send a wallet address.');
    rateLimit(`faucet:${address.toLowerCase()}`, 60_000);
    const w = operator();
    const txs: string[] = [];
    let monSent = '0';
    const native = await serverClient.getBalance({ address: address as Address });
    if (native < LOW) {
      txs.push(await w.sendTransaction({ to: address as Address, value: DRIP_MON }));
      monSent = (Number(DRIP_MON) / 1e18).toString();
    }
    const mints: [string, string][] = [
      ['WMON', '10000'],
      ['WETH', '0.5'],
    ];
    for (const [symbol, amt] of mints) {
      const t = tokenBySymbol(symbol);
      if (!t) continue;
      txs.push(
        await w.writeContract({
          address: t.address,
          abi: mockErc20Abi,
          functionName: 'mint',
          args: [address as Address, parseUnits(amt, t.decimals)],
        }),
      );
    }
    await Promise.all(
      txs.map((hash) => serverClient.waitForTransactionReceipt({ hash: hash as `0x${string}` })),
    );
    return json({ monSent, minted: Object.fromEntries(mints), txs });
  });
}
