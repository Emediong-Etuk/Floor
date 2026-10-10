import { getAddress, isAddressEqual, type Address, type Hex } from 'viem';

/**
 * 0x Swap API v2, AllowanceHolder flow (live mode). Docs:
 * https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getquote
 * The taker is FloorOrders (it holds the tokens during execute); txOrigin is the keeper EOA,
 * which 0x needs when the taker is a contract.
 */
export interface QuoteRequest {
  chainId: number;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  taker: Address;
  txOrigin: Address;
  slippageBps: number;
}

export interface Quote {
  buyAmount: bigint;
  minBuyAmount: bigint;
  target: Address;
  spender: Address;
  data: Hex;
}

export class QuoteError extends Error {}

interface QuoteResponse {
  liquidityAvailable?: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  transaction?: { to: string; data: string; value?: string };
  issues?: { allowance?: { spender: string } | null };
}

export class ZeroExClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    /** The only venue FloorOrders allowlists in live mode. */
    private readonly allowanceHolder: Address,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async quote(r: QuoteRequest): Promise<Quote | null> {
    const q = new URLSearchParams({
      chainId: String(r.chainId),
      sellToken: r.sellToken,
      buyToken: r.buyToken,
      sellAmount: r.sellAmount.toString(),
      taker: r.taker,
      txOrigin: r.txOrigin,
      slippageBps: String(r.slippageBps),
    });
    const res = await this.fetchFn(`${this.baseUrl}/swap/allowance-holder/quote?${q}`, {
      headers: { '0x-api-key': this.apiKey, '0x-version': 'v2' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new QuoteError(`0x quote HTTP ${res.status}`);
    const body = (await res.json()) as QuoteResponse;
    // No route at all for this pair/size right now.
    if (body.liquidityAvailable === false) return null;
    if (!body.transaction || !body.buyAmount) throw new QuoteError('0x quote missing transaction');
    if (body.transaction.value && BigInt(body.transaction.value) !== 0n) {
      throw new QuoteError('0x quote wants native value; FloorOrders sends none');
    }
    const target = getAddress(body.transaction.to);
    const spender = getAddress(body.issues?.allowance?.spender ?? body.transaction.to);
    // Never forward calldata to anything but the allowlisted AllowanceHolder.
    if (
      !isAddressEqual(target, this.allowanceHolder) ||
      !isAddressEqual(spender, this.allowanceHolder)
    ) {
      throw new QuoteError(`0x quote targets ${target}/${spender}, expected AllowanceHolder`);
    }
    return {
      buyAmount: BigInt(body.buyAmount),
      minBuyAmount: BigInt(body.minBuyAmount ?? body.buyAmount),
      target,
      spender,
      data: body.transaction.data as Hex,
    };
  }
}
