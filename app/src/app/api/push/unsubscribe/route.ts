import { isAddress } from 'viem';
import { getStore } from '@/lib/push';
import { HttpError, handle, json } from '@/lib/server';

/** POST { address, endpoint }: forget this device. Knowing the (secret) endpoint is the proof. */
export function POST(req: Request) {
  return handle(async () => {
    const { address, endpoint } = (await req.json()) as { address?: string; endpoint?: string };
    if (!address || !isAddress(address) || !endpoint)
      throw new HttpError(400, 'Missing address or endpoint.');
    await getStore().remove(address, endpoint);
    return json({ ok: true });
  });
}
