import type { Logger } from 'pino';

/**
 * Posts events to the app's /api/notify (which sends web push). Fire-and-forget: a slow or
 * failing app never holds up a fill. `once` keys make "floor hit, waiting for liquidity" and
 * "can't fill" messages go out a single time per order.
 */
export type NotifyEvent =
  | {
      type: 'selling';
      orderId: string;
      owner: string;
      txHash: string;
    }
  | {
      type: 'filled';
      orderId: string;
      owner: string;
      kind: 'floor' | 'cash-out';
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      amountOut: string;
      executorFee: string;
      priceE18: string;
      txHash: string;
      latencyMs: number;
    }
  | { type: 'waiting-liquidity'; orderId: string; owner: string }
  | { type: 'unfillable'; orderId: string; owner: string; reason: 'balance-or-allowance' };

export class Notifier {
  private readonly sent = new Set<string>();
  /** Local listeners (e.g. a one-shot sweep collecting what happened). */
  readonly listeners: ((event: NotifyEvent) => void)[] = [];

  constructor(
    private readonly url: string | undefined,
    private readonly secret: string | undefined,
    private readonly log: Logger,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Send unless an event with the same once-key already went out. */
  once(key: string, event: NotifyEvent): void {
    if (this.sent.has(key)) return;
    this.sent.add(key);
    this.send(event);
  }

  /** Allow a once-key to fire again (e.g. the order recovered and can fail anew). */
  reset(key: string): void {
    this.sent.delete(key);
  }

  send(event: NotifyEvent): void {
    this.log.info({ notify: event }, 'notify');
    for (const l of this.listeners) l(event);
    if (!this.url || !this.secret) return;
    this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (!r.ok) this.log.warn({ status: r.status, type: event.type }, 'notify rejected');
      })
      .catch((err: unknown) =>
        this.log.warn({ err: String(err), type: event.type }, 'notify failed'),
      );
  }
}
