import type { Hex } from 'viem';
import { parseHermes, type HermesLatestResponse, type PythPrice } from '@floor/shared';

/**
 * Pyth Hermes client (optional, D-004). Since 2026-08-26 Hermes needs an API key, sent as a
 * bearer token. Docs: https://docs.pyth.network/price-feeds/core/fetch-price-updates
 * Polls the REST endpoint; the SSE stream (/v2/updates/price/stream) is a later improvement.
 */
export class HermesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async latest(feedIds: Hex[]): Promise<{ updateData: Hex[]; prices: PythPrice[] }> {
    const q = new URLSearchParams({ encoding: 'hex' });
    for (const id of feedIds) q.append('ids[]', id);
    const res = await this.fetchFn(`${this.baseUrl}/v2/updates/price/latest?${q}`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
    return parseHermes((await res.json()) as HermesLatestResponse);
  }
}
