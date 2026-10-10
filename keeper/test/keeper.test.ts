import { describe, expect, it, vi } from 'vitest';
import {
  ContractFunctionRevertedError,
  encodeErrorResult,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { executeAbi } from '../src/abi.ts';
import type { FillResult } from '../src/chain.ts';
import { Keeper, type ChainPort, type Venue } from '../src/keeper.ts';
import { Metrics } from '../src/metrics.ts';
import { Notifier } from '../src/notifier.ts';
import type { Order, PriceSnapshot, SwapData } from '../src/types.ts';
import { HASH, OWNER, e18, order, params, prices, silent } from './helpers.ts';

const receipt = (status: 'success' | 'reverted' = 'success'): TransactionReceipt =>
  ({
    status,
    transactionHash: HASH,
    gasUsed: 300_000n,
    effectiveGasPrice: 102n * 10n ** 9n,
  }) as TransactionReceipt;

const filled = (): FillResult => ({
  receipt: receipt(),
  filled: { amountOut: 28_913_058n, executorFee: 28_942n, priceE18: e18(0.029) },
});

function revert(errorName: string, args: readonly unknown[]) {
  return new ContractFunctionRevertedError({
    abi: executeAbi,
    data: encodeErrorResult({ abi: executeAbi, errorName, args } as never),
    functionName: 'execute',
  });
}

/** In-memory chain: tests script balances, prices and how sends/receipts behave. */
class FakeChain implements ChainPort {
  account = { address: '0x00000000000000000000000000000000000000e1' as Address };
  floorAddress = '0x00000000000000000000000000000000000000f1' as Address;
  orders: Order[] = [];
  priceMap = prices(0.029);
  balance = 10n ** 30n;
  allowance = 10n ** 30n;
  sends: { id: bigint; value: bigint; swap: SwapData }[] = [];
  expires: bigint[] = [];
  sendError: unknown;
  /** What waitForFill returns (null = timeout). Can be a promise to hold the fill "in flight". */
  wait: () => Promise<FillResult | null> = async () => filled();
  receiptResult: FillResult | null = null;
  fee = 0n;

  async activeOrders() {
    return this.orders;
  }
  async order(id: bigint) {
    return this.orders.find((o) => o.id === id) ?? order({ id, status: 3 });
  }
  async params() {
    return params;
  }
  async prices(): Promise<Map<Address, PriceSnapshot>> {
    return new Map(this.priceMap);
  }
  async balanceAndAllowance() {
    return { balance: this.balance, allowance: this.allowance };
  }
  async updateFee() {
    return this.fee;
  }
  async sendExecute(id: bigint, _u: Hex[], swap: SwapData, value: bigint) {
    if (this.sendError) throw this.sendError;
    this.sends.push({ id, value, swap });
    return HASH;
  }
  async sendExpire(id: bigint) {
    this.expires.push(id);
    return HASH;
  }
  async waitForFill() {
    return this.wait();
  }
  async receipt() {
    return this.receiptResult;
  }
}

const venue: Venue = {
  build: async () => ({ swap: { target: OWNER, spender: OWNER, data: '0x' as Hex } }),
};

function setup(over: Partial<FakeChain> = {}) {
  const chain = Object.assign(new FakeChain(), over);
  const metrics = new Metrics();
  const fetchFn = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
  const notifier = new Notifier('https://app/api/notify', 's', silent, fetchFn);
  let t = 10_000;
  const keeper = new Keeper(chain, venue, notifier, metrics, silent, {
    gasMultiplier: 1.15,
    now: () => t,
  });
  const advance = (ms: number) => (t += ms);
  const notified = () =>
    (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.map(
      (c) => (JSON.parse(String(c[1].body)) as { type: string }).type,
    );
  return { chain, keeper, metrics, advance, notified };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Keeper', () => {
  it('fills a triggered order once, records latency and notifies selling + filled', async () => {
    const { chain, keeper, metrics, notified } = setup({ orders: [order()] });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    expect(chain.sends).toHaveLength(1);
    expect(metrics.fills).toBe(1);
    expect(keeper.orders.size).toBe(0);
    expect(notified()).toEqual(['selling', 'filled']);
  });

  it('never double-submits while a fill is in flight or pending a receipt', async () => {
    let release!: (r: FillResult | null) => void;
    const { chain, keeper, advance } = setup({
      orders: [order()],
      wait: () => new Promise((r) => (release = r)),
    });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    await keeper.tick(2n, 1_000n); // same order still triggered
    await flush();
    expect(chain.sends).toHaveLength(1);

    release(null); // receipt wait timed out: tx may still land
    await flush();
    expect(keeper.pending.size).toBe(1);
    await keeper.tick(3n, 1_001n); // checks the receipt first (none yet) and does NOT resend
    await flush();
    expect(chain.sends).toHaveLength(1);

    chain.receiptResult = filled(); // it landed after all
    advance(1_000);
    await keeper.tick(4n, 1_002n);
    await flush();
    expect(keeper.pending.size).toBe(0);
    expect(keeper.orders.size).toBe(0);
    expect(chain.sends).toHaveLength(1);
  });

  it('gives up on a pending tx with no receipt after the timeout, then may retry', async () => {
    const { chain, keeper, advance, metrics } = setup({
      orders: [order()],
      wait: async () => null,
    });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    advance(121_000);
    await keeper.tick(2n, 1_001n);
    await flush();
    expect(metrics.failures.dropped).toBe(1);
    expect(chain.sends).toHaveLength(2);
  });

  it('skips and notifies once when the owner moved tokens, then backs off', async () => {
    const { chain, keeper, notified, advance } = setup({ orders: [order()], balance: 1n });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    await keeper.tick(2n, 1_000n);
    await flush();
    expect(chain.sends).toHaveLength(0);
    expect(notified()).toEqual(['unfillable']);
    chain.balance = 10n ** 30n; // tokens are back
    advance(31_000);
    await keeper.tick(3n, 1_001n);
    await flush();
    expect(chain.sends).toHaveLength(1);
  });

  it('waits for liquidity (once) when the venue cannot clear minOut', async () => {
    const { chain, keeper, notified } = setup({ orders: [order()] });
    const waiting: Venue = { build: async () => ({ wait: 'liquidity' }) };
    (keeper as unknown as { venue: Venue }).venue = waiting;
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    await keeper.tick(2n, 1_000n);
    await flush();
    expect(chain.sends).toHaveLength(0);
    expect(notified()).toEqual(['waiting-liquidity']);
  });

  it('treats NotActive as filled by someone else and drops the order', async () => {
    const { keeper, metrics } = setup({ orders: [order()], sendError: revert('NotActive', [1n]) });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    expect(keeper.orders.size).toBe(0);
    expect(metrics.failures.NotActive).toBe(1);
  });

  it('a simulated InsufficientOutput (demo liquidity gap) becomes a liquidity wait', async () => {
    const { keeper, notified } = setup({
      orders: [order()],
      sendError: revert('InsufficientOutput', [1n, 2n]),
    });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    expect(keeper.orders.size).toBe(1);
    expect(notified()).toEqual(['waiting-liquidity']);
  });

  it('forgets the OCO sibling when one leg fills', async () => {
    const stop = order({ id: 1n, linkedOrderId: 2n });
    const tp = order({ id: 2n, kind: 1, triggerPriceE18: e18(0.04), linkedOrderId: 1n });
    const { keeper } = setup({ orders: [stop, tp] });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    expect(keeper.orders.size).toBe(0);
  });

  it('pays the oracle update fee as msg.value', async () => {
    const { chain, keeper } = setup({ orders: [order()], fee: 7n });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    expect(chain.sends[0]?.value).toBe(7n);
  });

  it('expires past-expiry orders when no fill is in flight', async () => {
    const { chain, keeper, metrics } = setup({ orders: [order({ expiry: 900n })] });
    await keeper.resync();
    await keeper.tick(1n, 1_000n);
    await flush();
    expect(chain.expires).toEqual([1n]);
    expect(metrics.expiries).toBe(1);
    expect(keeper.orders.size).toBe(0);
  });

  it('refresh() adds new active orders and drops inactive ones', async () => {
    const { chain, keeper } = setup();
    await keeper.resync();
    chain.orders = [order({ id: 5n })];
    await keeper.refresh(5n);
    expect(keeper.orders.has(5n)).toBe(true);
    chain.orders = [];
    await keeper.refresh(5n);
    expect(keeper.orders.has(5n)).toBe(false);
  });
});
