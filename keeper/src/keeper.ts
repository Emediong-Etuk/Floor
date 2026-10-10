import type { Address, Hex } from 'viem';
import type { Logger } from 'pino';
import { OrderKind, OrderStatus } from '@floor/shared';
import { classify } from './errors.ts';
import { evaluate, type Candidate } from './evaluate.ts';
import type { FillResult } from './chain.ts';
import type { Metrics } from './metrics.ts';
import type { Notifier } from './notifier.ts';
import type { ContractParams, Order, PriceSnapshot, SwapData } from './types.ts';

/** The RPC surface the keeper needs (FloorChain implements it; tests use a fake). */
export interface ChainPort {
  account: { address: Address };
  floorAddress: Address;
  activeOrders(): Promise<Order[]>;
  order(id: bigint): Promise<Order>;
  params(tokens: Address[]): Promise<ContractParams>;
  prices(tokens: Address[]): Promise<Map<Address, PriceSnapshot>>;
  balanceAndAllowance(order: Order): Promise<{ balance: bigint; allowance: bigint }>;
  updateFee(updateData: Hex[]): Promise<bigint>;
  sendExecute(
    id: bigint,
    updateData: Hex[],
    swap: SwapData,
    value: bigint,
    gasMultiplier: number,
  ): Promise<Hex>;
  sendExpire(id: bigint, gasMultiplier: number): Promise<Hex>;
  waitForFill(hash: Hex, timeoutMs: number): Promise<FillResult | null>;
  receipt(hash: Hex): Promise<FillResult | null>;
}

/** Builds the swap call for a fill: MockRouter (demo) or a 0x quote (live). */
export interface Venue {
  build(order: Order, minOut: bigint): Promise<{ swap: SwapData } | { wait: 'liquidity' }>;
}

/** Optional fresher prices plus the update bytes `execute` posts (Hermes, live mode). */
export interface UpdateSource {
  overlay(prices: Map<Address, PriceSnapshot>, tokens: Address[]): Promise<void>;
  updateData(tokens: Address[]): Promise<Hex[]>;
}

export interface KeeperOptions {
  gasMultiplier: number;
  receiptTimeoutMs?: number;
  /** Drop a pending tx with no receipt after this long (it was most likely never included). */
  pendingGiveUpMs?: number;
  /** Re-check an unfillable order (moved tokens / cut allowance) after this long. */
  unfillableBackoffMs?: number;
  maxExpiresPerTick?: number;
  now?: () => number;
}

interface Pending {
  hash: Hex;
  sentAt: number;
  order: Order;
}

/**
 * The keeper loop (build prompt §7.1): mirror the active order set, evaluate every block with
 * the contract's own rules, and fill what's triggered. Each order has at most one fill in
 * flight, and a sent transaction is never re-sent until its receipt has been checked.
 */
export class Keeper {
  readonly orders = new Map<bigint, Order>();
  params: ContractParams = {
    decimals: new Map(),
    maxAge: new Map(),
    maxConfBps: 100,
    executorFeeBps: 0,
  };
  readonly inFlight = new Set<bigint>();
  readonly pending = new Map<bigint, Pending>();
  lastBlock: { number: bigint; timestamp: bigint; seenAt: number } | undefined;
  lastPrices = new Map<Address, PriceSnapshot>();

  private readonly detectedAt = new Map<bigint, number>();
  private readonly unfillableUntil = new Map<bigint, number>();
  private readonly expiring = new Set<bigint>();
  private ticking = false;
  private readonly now: () => number;

  constructor(
    private readonly chain: ChainPort,
    private readonly venue: Venue,
    private readonly notifier: Notifier,
    private readonly metrics: Metrics,
    private readonly log: Logger,
    private readonly opts: KeeperOptions,
    private readonly updates?: UpdateSource,
  ) {
    this.now = opts.now ?? Date.now;
  }

  // ------------------------------------------------------------------ order set

  /** Full reload from `getActiveOrders` (startup, and every 30 s as a safety net). */
  async resync(): Promise<void> {
    const active = await this.chain.activeOrders();
    const fresh = new Map(active.map((o) => [o.id, o] as const));
    this.orders.clear();
    for (const [id, o] of fresh) this.orders.set(id, o);
    this.params = await this.chain.params(this.tokens());
    this.log.debug({ active: this.orders.size }, 'resynced');
  }

  /** OrderCreated / OrderUpdated: re-read the order from chain. */
  async refresh(id: bigint): Promise<void> {
    const o = await this.chain.order(id);
    if (o.status !== OrderStatus.ACTIVE) {
      this.forget(id);
      return;
    }
    const isNewToken =
      !this.params.decimals.has(o.tokenIn) || !this.params.decimals.has(o.tokenOut);
    this.orders.set(id, o);
    if (isNewToken) this.params = await this.chain.params(this.tokens());
  }

  /** OrderCancelled / OrderFilled / OrderExpired. */
  forget(id: bigint): void {
    this.orders.delete(id);
    this.detectedAt.delete(id);
    this.unfillableUntil.delete(id);
  }

  tokens(): Address[] {
    const set = new Set<Address>();
    for (const o of this.orders.values()) {
      set.add(o.tokenIn);
      set.add(o.tokenOut);
    }
    return [...set];
  }

  // ------------------------------------------------------------------ per block

  /** Called on every new block. Overlapping ticks are skipped, not queued. */
  async tick(blockNumber: bigint, timestamp: bigint): Promise<void> {
    this.lastBlock = { number: blockNumber, timestamp, seenAt: this.now() };
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.checkPending();
      const tokens = this.tokens();
      if (tokens.length === 0) return;
      const prices = await this.chain.prices(tokens);
      if (this.updates) await this.updates.overlay(prices, tokens);
      this.lastPrices = prices;

      const idle = [...this.orders.values()].filter(
        (o) => !this.inFlight.has(o.id) && !this.pending.has(o.id),
      );
      const ev = evaluate(idle, prices, this.params, timestamp);

      for (const id of ev.untriggered) {
        this.detectedAt.delete(id);
        this.notifier.reset(`liquidity:${id}`);
      }
      for (const b of ev.blocked) this.metrics.skip(b.reason);
      for (const c of ev.triggered) {
        if ((this.unfillableUntil.get(c.order.id) ?? 0) > this.now()) continue;
        if (!this.detectedAt.has(c.order.id)) this.detectedAt.set(c.order.id, this.now());
        void this.fill(c);
      }
      // Expiries are housekeeping: a few per block, never ahead of fills.
      if (this.inFlight.size === 0) {
        const max = this.opts.maxExpiresPerTick ?? 3;
        for (const o of ev.expired.filter((x) => !this.expiring.has(x.id)).slice(0, max)) {
          void this.expire(o);
        }
      }
    } catch (err) {
      this.log.warn({ err: String(err) }, 'tick failed');
    } finally {
      this.ticking = false;
    }
  }

  // ------------------------------------------------------------------ fills

  /** One fill attempt (§7.1 step 4 a–g). Never runs twice at once for the same order. */
  async fill(c: Candidate): Promise<void> {
    const { order } = c;
    const id = order.id;
    if (this.inFlight.has(id) || this.pending.has(id)) return;
    this.inFlight.add(id);
    try {
      // a) Owner still has the tokens and the allowance?
      const { balance, allowance } = await this.chain.balanceAndAllowance(order);
      if (balance < order.amountIn || allowance < order.amountIn) {
        this.markUnfillable(order);
        return;
      }
      this.notifier.reset(`unfillable:${id}`);

      // b, c) Swap route that clears minOut, or wait for liquidity.
      const built = await this.venue.build(order, c.minOut);
      if ('wait' in built) {
        this.waitForLiquidity(order);
        return;
      }

      // d) Price update bytes (Hermes) and their fee; empty when using push prices.
      const tokens = [order.tokenIn, order.tokenOut];
      const updateData = this.updates ? await this.updates.updateData(tokens) : [];
      const fee = await this.chain.updateFee(updateData);

      // e, f) Simulate, estimate × multiplier, send.
      const hash = await this.chain.sendExecute(
        id,
        updateData,
        built.swap,
        fee,
        this.opts.gasMultiplier,
      );
      this.pending.set(id, { hash, sentAt: this.now(), order });
      this.log.info({ id: String(id), hash }, 'execute sent');
      this.notifier.send({
        type: 'selling',
        orderId: String(id),
        owner: order.owner,
        txHash: hash,
      });

      // g) Receipt. A timeout leaves it pending; checkPending picks it up next block.
      const res = await this.chain.waitForFill(hash, this.opts.receiptTimeoutMs ?? 30_000);
      if (res) this.settle(id, res);
    } catch (err) {
      this.handleFailure(order, err);
    } finally {
      this.inFlight.delete(id);
    }
  }

  private settle(id: bigint, res: FillResult): void {
    const p = this.pending.get(id);
    this.pending.delete(id);
    const order = p?.order ?? this.orders.get(id);
    if (res.receipt.status !== 'success' || !res.filled || !order) {
      this.metrics.fail('reverted');
      this.log.warn({ id: String(id), hash: res.receipt.transactionHash }, 'execute reverted');
      return;
    }
    const latencyMs = this.now() - (this.detectedAt.get(id) ?? p?.sentAt ?? this.now());
    this.metrics.recordFill(latencyMs, res.receipt.gasUsed, res.receipt.effectiveGasPrice);
    this.notifier.send({
      type: 'filled',
      orderId: String(id),
      owner: order.owner,
      kind: order.kind === OrderKind.STOP_LOSS ? 'floor' : 'cash-out',
      tokenIn: order.tokenIn,
      tokenOut: order.tokenOut,
      amountIn: order.amountIn.toString(),
      amountOut: res.filled.amountOut.toString(),
      executorFee: res.filled.executorFee.toString(),
      priceE18: res.filled.priceE18.toString(),
      txHash: res.receipt.transactionHash,
      latencyMs,
    });
    this.log.info({ id: String(id), latencyMs, hash: res.receipt.transactionHash }, 'filled');
    this.forget(id);
    // The contract cancelled the OCO sibling in the same tx.
    if (order.linkedOrderId !== 0n) this.forget(order.linkedOrderId);
  }

  /** Never resend before checking the receipt of what was already sent. */
  private async checkPending(): Promise<void> {
    for (const [id, p] of this.pending) {
      if (this.inFlight.has(id)) continue;
      const res = await this.chain.receipt(p.hash);
      if (res) {
        this.settle(id, res);
      } else if (this.now() - p.sentAt > (this.opts.pendingGiveUpMs ?? 120_000)) {
        this.pending.delete(id);
        this.metrics.fail('dropped');
        this.log.warn({ id: String(id), hash: p.hash }, 'no receipt; treating tx as dropped');
      }
    }
  }

  private handleFailure(order: Order, err: unknown): void {
    const c = classify(err);
    this.metrics.fail(c.errorName ?? c.outcome);
    switch (c.outcome) {
      case 'done': // filled or cancelled by someone else
        this.forget(order.id);
        break;
      case 'unfillable':
        this.markUnfillable(order);
        break;
      case 'liquidity':
        this.waitForLiquidity(order);
        break;
      default:
        break;
    }
    this.log.info(
      { id: String(order.id), outcome: c.outcome, error: c.errorName ?? c.message },
      'execute skipped',
    );
  }

  private markUnfillable(order: Order): void {
    this.unfillableUntil.set(order.id, this.now() + (this.opts.unfillableBackoffMs ?? 30_000));
    this.metrics.skip('unfillable');
    this.notifier.once(`unfillable:${order.id}`, {
      type: 'unfillable',
      orderId: String(order.id),
      owner: order.owner,
      reason: 'balance-or-allowance',
    });
  }

  private waitForLiquidity(order: Order): void {
    this.metrics.skip('liquidity');
    this.notifier.once(`liquidity:${order.id}`, {
      type: 'waiting-liquidity',
      orderId: String(order.id),
      owner: order.owner,
    });
  }

  // ------------------------------------------------------------------ expiry

  async expire(order: Order): Promise<void> {
    if (this.expiring.has(order.id)) return;
    this.expiring.add(order.id);
    try {
      const hash = await this.chain.sendExpire(order.id, this.opts.gasMultiplier);
      const res = await this.chain.waitForFill(hash, this.opts.receiptTimeoutMs ?? 30_000);
      if (res?.receipt.status === 'success') {
        this.metrics.expiries++;
        this.forget(order.id);
      }
    } catch (err) {
      const c = classify(err);
      if (c.outcome === 'done') this.forget(order.id);
      else
        this.log.info({ id: String(order.id), error: c.errorName ?? c.message }, 'expire skipped');
    } finally {
      this.expiring.delete(order.id);
    }
  }
}
