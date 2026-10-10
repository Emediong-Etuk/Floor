import { handle, json, requireDemo, runSweep } from '@/lib/server';

/** POST: run one on-demand keeper pass now (called after a protection is created). */
export function POST() {
  return handle(async () => {
    requireDemo();
    const r = await runSweep();
    return json({ durationMs: r.durationMs, activeOrders: r.activeOrders, events: r.events });
  });
}
