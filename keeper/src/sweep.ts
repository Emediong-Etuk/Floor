import { pino, type Logger } from 'pino';
import type { KeeperConfig } from './config.ts';
import { FloorChain } from './chain.ts';
import { Keeper } from './keeper.ts';
import { Metrics } from './metrics.ts';
import { Notifier, type NotifyEvent } from './notifier.ts';
import { MockRouterVenue } from './venues.ts';

export interface SweepResult {
  durationMs: number;
  activeOrders: number;
  events: NotifyEvent[];
}

/**
 * One on-demand keeper pass (D-011): load active orders, then tick block by block until
 * nothing is triggered or in flight (or `maxMs` passes). Used by the app's serverless routes
 * in demo mode, where prices only move when the /demo panel moves them. Same Keeper code as
 * the always-on process, so the same safety rules apply.
 */
export async function sweep(
  cfg: KeeperConfig,
  opts: { maxMs?: number; log?: Logger } = {},
): Promise<SweepResult> {
  if (cfg.MODE !== 'demo') throw new Error('on-demand sweeps are for demo mode');
  const start = Date.now();
  const log = opts.log ?? pino({ level: 'silent' });
  const chain = new FloorChain(cfg);
  const notifier = new Notifier(cfg.NOTIFY_URL, cfg.NOTIFY_SECRET, log);
  const events: NotifyEvent[] = [];
  notifier.listeners.push((e) => events.push(e));
  const keeper = new Keeper(
    chain,
    new MockRouterVenue(cfg.SWAP_TARGET, cfg.FLOOR_ADDRESS),
    notifier,
    new Metrics(),
    log,
    { gasMultiplier: cfg.GAS_MULTIPLIER, receiptTimeoutMs: 15_000 },
  );
  await keeper.resync();
  const deadline = start + (opts.maxMs ?? 12_000);
  let lastBlock = -1n;
  while (Date.now() < deadline && keeper.orders.size > 0) {
    const block = await chain.client.getBlock();
    if (block.number === lastBlock) {
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    lastBlock = block.number;
    await keeper.tick(block.number, block.timestamp);
    await keeper.settled();
    if (keeper.lastTriggered === 0 && keeper.pending.size === 0) break;
  }
  return { durationMs: Date.now() - start, activeOrders: keeper.orders.size, events };
}
