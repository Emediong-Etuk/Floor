import type { NotifyEvent } from '@floor/keeper/notifier';
import { notifyOwner } from '@/lib/push';
import { HttpError, handle, json } from '@/lib/server';

const TYPES = new Set(['selling', 'filled', 'waiting-liquidity', 'unfillable']);

/**
 * POST (keeper → app): Authorization: Bearer NOTIFY_SECRET, body = a keeper NotifyEvent.
 * Used by the always-on keeper (`pnpm keeper:start` with NOTIFY_URL pointing here). The
 * on-demand sweep inside the app pushes directly, without this hop.
 */
export function POST(req: Request) {
  return handle(async () => {
    const secret = process.env.NOTIFY_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
      throw new HttpError(401, 'Unauthorized.');
    const event = (await req.json()) as NotifyEvent;
    if (!event || !TYPES.has(event.type) || typeof event.owner !== 'string')
      throw new HttpError(400, 'Unknown event.');
    return json(await notifyOwner(event.owner, event));
  });
}
