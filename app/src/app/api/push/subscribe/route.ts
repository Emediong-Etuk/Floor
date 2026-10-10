import { getStore, isPushSubscription, notifyOwner, verifySubscribe } from '@/lib/push';
import { HttpError, handle, json, rateLimit } from '@/lib/server';

/**
 * POST { address, subscription, signature, issuedAt }: saves this device's push subscription
 * for `address`, after checking the wallet signed it (lib/push-message.ts), then sends a
 * "alerts are on" push so the user sees it work.
 */
export function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as {
      address?: string;
      subscription?: unknown;
      signature?: string;
      issuedAt?: string;
    };
    if (
      !body.address ||
      !isPushSubscription(body.subscription) ||
      !body.signature ||
      !body.issuedAt
    ) {
      throw new HttpError(400, 'Missing address, subscription or signature.');
    }
    rateLimit(`push:${body.address.toLowerCase()}`, 2_000);
    const ok = await verifySubscribe({
      address: body.address,
      subscription: body.subscription,
      signature: body.signature,
      issuedAt: body.issuedAt,
    });
    if (!ok) throw new HttpError(401, 'Signature check failed. Try turning alerts on again.');
    await getStore().add(body.address, body.subscription);
    const welcome = await notifyOwner(body.address, { type: 'welcome' });
    return json({ ok: true, welcome });
  });
}
