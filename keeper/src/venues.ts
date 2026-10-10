import { encodeFunctionData, type Address, type Hex } from 'viem';
import { mockRouterAbi } from '@floor/shared';
import type { Venue, UpdateSource } from './keeper.ts';
import type { Order, PriceSnapshot } from './types.ts';
import type { ZeroExClient } from './zeroex.ts';
import type { HermesClient } from './hermes.ts';

/** Demo mode: sell through MockRouter at the MockOracle price (minus its spread). */
export class MockRouterVenue implements Venue {
  constructor(
    private readonly router: Address,
    private readonly floor: Address,
  ) {}

  async build(order: Order, minOut: bigint) {
    const data = encodeFunctionData({
      abi: mockRouterAbi,
      functionName: 'swap',
      args: [order.tokenIn, order.tokenOut, order.amountIn, minOut, this.floor],
    });
    return { swap: { target: this.router, spender: this.router, data } };
  }
}

/** Live mode: a 0x quote whose expected output clears minOut (§7.1 step 4 b–c). */
export class ZeroExVenue implements Venue {
  constructor(
    private readonly zeroEx: ZeroExClient,
    private readonly chainId: number,
    private readonly floor: Address,
    private readonly keeper: Address,
  ) {}

  async build(order: Order, minOut: bigint) {
    const q = await this.zeroEx.quote({
      chainId: this.chainId,
      sellToken: order.tokenIn,
      buyToken: order.tokenOut,
      sellAmount: order.amountIn,
      taker: this.floor,
      txOrigin: this.keeper,
      slippageBps: order.maxSlippageBps,
    });
    // Not enough liquidity to sell within the user's limit: wait for the next block.
    if (!q || q.buyAmount < minOut) return { wait: 'liquidity' as const };
    return { swap: { target: q.target, spender: q.spender, data: q.data } };
  }
}

/**
 * Live mode with a Hermes key (D-004 option C): fresher prices for trigger checks, and the
 * signed update bytes `execute` posts on-chain. Responses are reused for `cacheMs`.
 */
export class HermesUpdates implements UpdateSource {
  private cache:
    { at: number; key: string; data: Awaited<ReturnType<HermesClient['latest']>> } | undefined;
  private readonly feeds = new Map<Address, Hex>();

  constructor(
    private readonly hermes: HermesClient,
    /** token → Pyth feed id, e.g. PythAdapter.feedIds(token). Looked up once per token. */
    private readonly feedFor: (token: Address) => Promise<Hex>,
    private readonly cacheMs = 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  private async feed(token: Address): Promise<Hex> {
    let f = this.feeds.get(token);
    if (!f) {
      f = (await this.feedFor(token)).toLowerCase() as Hex;
      this.feeds.set(token, f);
    }
    return f;
  }

  private async fetch(tokens: Address[], maxAgeMs: number) {
    const ids = [...new Set(await Promise.all(tokens.map((t) => this.feed(t))))].sort();
    const key = ids.join(',');
    if (this.cache && this.cache.key === key && this.now() - this.cache.at <= maxAgeMs) {
      return this.cache.data;
    }
    const data = await this.hermes.latest(ids);
    this.cache = { at: this.now(), key, data };
    return data;
  }

  async overlay(prices: Map<Address, PriceSnapshot>, tokens: Address[]): Promise<void> {
    const { prices: fresh } = await this.fetch(tokens, this.cacheMs);
    for (const token of tokens) {
      const feed = await this.feed(token);
      const p = fresh.find((x) => x.feedId === feed);
      const current = prices.get(token);
      if (p && (!current || p.publishTime > current.publishTime)) {
        prices.set(token, { priceE18: p.priceE18, confE18: p.confE18, publishTime: p.publishTime });
      }
    }
  }

  async updateData(tokens: Address[]): Promise<Hex[]> {
    // Always fresh for a fill: the update must cover the price the trigger used.
    return (await this.fetch(tokens, 0)).updateData;
  }
}
