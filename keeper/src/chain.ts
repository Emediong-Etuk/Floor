import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  parseEventLogs,
  webSocket,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  type Account,
} from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';
import { chainFor, floorOracleAbi } from '@floor/shared';
import { executeAbi } from './abi.ts';
import type { KeeperConfig } from './config.ts';
import type { ContractParams, Order, PriceSnapshot, SwapData } from './types.ts';

/** Local anvil (rehearsals and tests). No Multicall3 there, so reads fall back to parallel calls. */
function anvil(rpc: string): Chain {
  return defineChain({
    id: 31_337,
    name: 'Anvil',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

export interface FillResult {
  receipt: TransactionReceipt;
  filled?: { amountOut: bigint; executorFee: bigint; priceE18: bigint };
}

/**
 * Every RPC interaction the keeper makes. viem retries transient HTTP errors itself
 * (exponential backoff); the nonce manager hands out nonces locally so concurrent sends
 * never collide.
 */
export class FloorChain {
  readonly chain: Chain;
  readonly client: PublicClient;
  /** Subscriptions (blocks, events). Same as `client` when no websocket URL is configured. */
  readonly subscriber: PublicClient;
  readonly account: Account;
  private readonly wallet: WalletClient;
  private readonly floor: Address;
  private readonly oracle: Address;
  private readonly hasMulticall: boolean;

  constructor(cfg: KeeperConfig) {
    this.chain = cfg.CHAIN_ID === 31_337 ? anvil(cfg.RPC_HTTP_URL) : chainFor(cfg.CHAIN_ID);
    this.hasMulticall = Boolean(this.chain.contracts?.multicall3);
    const transport = http(cfg.RPC_HTTP_URL, { retryCount: 3, retryDelay: 200 });
    this.client = createPublicClient({
      chain: this.chain,
      transport,
      pollingInterval: cfg.POLL_INTERVAL_MS,
    });
    this.subscriber = cfg.RPC_WS_URL
      ? createPublicClient({
          chain: this.chain,
          transport: webSocket(cfg.RPC_WS_URL, { retryCount: 10, reconnect: true }),
        })
      : this.client;
    this.account = privateKeyToAccount(cfg.KEEPER_PRIVATE_KEY, { nonceManager });
    this.wallet = createWalletClient({ account: this.account, chain: this.chain, transport });
    this.floor = cfg.FLOOR_ADDRESS;
    this.oracle = cfg.ORACLE_ADDRESS;
  }

  get floorAddress(): Address {
    return this.floor;
  }

  // ------------------------------------------------------------------ reads

  /** Batched reads: one Multicall3 call where it exists, parallel eth_calls otherwise. */
  private async readMany<T>(
    calls: {
      address: Address;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }[],
  ): Promise<T[]> {
    if (calls.length === 0) return [];
    if (this.hasMulticall) {
      const res = await this.client.multicall({ contracts: calls as never, allowFailure: false });
      return res as T[];
    }
    return Promise.all(calls.map((c) => this.client.readContract(c as never))) as Promise<T[]>;
  }

  async activeOrders(pageSize = 200n): Promise<Order[]> {
    const out: Order[] = [];
    for (let offset = 0n; ; offset += pageSize) {
      const [ids, orders] = (await this.client.readContract({
        address: this.floor,
        abi: executeAbi,
        functionName: 'getActiveOrders',
        args: [offset, pageSize],
      })) as readonly [readonly bigint[], readonly Omit<Order, 'id'>[]];
      ids.forEach((id, i) => out.push({ ...(orders[i] as Omit<Order, 'id'>), id }));
      if (BigInt(ids.length) < pageSize) return out;
    }
  }

  async order(id: bigint): Promise<Order> {
    const o = (await this.client.readContract({
      address: this.floor,
      abi: executeAbi,
      functionName: 'getOrder',
      args: [id],
    })) as Omit<Order, 'id'>;
    return { ...o, id };
  }

  async params(tokens: Address[]): Promise<ContractParams> {
    const fn = (functionName: string, args?: readonly unknown[]) => ({
      address: this.floor,
      abi: executeAbi,
      functionName,
      ...(args ? { args } : {}),
    });
    const [maxConfBps, executorFeeBps, ...rest] = await this.readMany<number | bigint>([
      fn('maxConfBps'),
      fn('executorFeeBps'),
      ...tokens.map((t) => fn('tokenDecimals', [t])),
      ...tokens.map((t) => fn('oracleAgeFor', [t])),
    ]);
    const decimals = new Map<Address, number>();
    const maxAge = new Map<Address, bigint>();
    tokens.forEach((t, i) => {
      decimals.set(t, Number(rest[i]));
      maxAge.set(t, BigInt(rest[tokens.length + i] ?? 15));
    });
    return {
      decimals,
      maxAge,
      maxConfBps: Number(maxConfBps),
      executorFeeBps: Number(executorFeeBps),
    };
  }

  /** Cached oracle prices (MockOracle in demo, PythAdapter's sponsored-push cache in live). */
  async prices(tokens: Address[]): Promise<Map<Address, PriceSnapshot>> {
    const res = await this.readMany<readonly [bigint, bigint, bigint]>(
      tokens.map((t) => ({
        address: this.oracle,
        abi: floorOracleAbi,
        functionName: 'getPriceE18',
        args: [t],
      })),
    );
    const out = new Map<Address, PriceSnapshot>();
    tokens.forEach((t, i) => {
      const r = res[i];
      if (r) out.set(t, { priceE18: r[0], confE18: r[1], publishTime: r[2] });
    });
    return out;
  }

  /** PythAdapter.feedIds(token), live mode only. */
  async feedId(token: Address): Promise<Hex> {
    return this.client.readContract({
      address: this.oracle,
      abi: [
        {
          type: 'function',
          name: 'feedIds',
          stateMutability: 'view',
          inputs: [{ name: 'token', type: 'address' }],
          outputs: [{ name: '', type: 'bytes32' }],
        },
      ] as const,
      functionName: 'feedIds',
      args: [token],
    });
  }

  async balanceAndAllowance(order: Order): Promise<{ balance: bigint; allowance: bigint }> {
    const [balance, allowance] = await this.readMany<bigint>([
      { address: order.tokenIn, abi: erc20Abi, functionName: 'balanceOf', args: [order.owner] },
      {
        address: order.tokenIn,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [order.owner, this.floor],
      },
    ]);
    return { balance: balance ?? 0n, allowance: allowance ?? 0n };
  }

  async updateFee(updateData: Hex[]): Promise<bigint> {
    if (updateData.length === 0) return 0n;
    return this.client.readContract({
      address: this.oracle,
      abi: floorOracleAbi,
      functionName: 'updateFee',
      args: [updateData],
    });
  }

  async swapTargetAllowed(target: Address, spender: Address): Promise<boolean> {
    return (await this.client.readContract({
      address: this.floor,
      abi: executeAbi,
      functionName: 'swapTargetAllowed',
      args: [target, spender],
    })) as boolean;
  }

  async floorOracle(): Promise<Address> {
    return (await this.client.readContract({
      address: this.floor,
      abi: executeAbi,
      functionName: 'oracle',
    })) as Address;
  }

  async balance(): Promise<bigint> {
    return this.client.getBalance({ address: this.account.address });
  }

  // ------------------------------------------------------------------ writes

  /**
   * Simulate, estimate, send. Throws (viem errors, decoded by errors.ts) if the simulation
   * reverts, so nothing is sent for a fill that would fail. Gas limit = estimate × multiplier:
   * Monad charges the gas *limit*, so a tight limit is real money.
   */
  async sendExecute(
    id: bigint,
    updateData: Hex[],
    swap: SwapData,
    value: bigint,
    gasMultiplier: number,
  ): Promise<Hex> {
    const req = {
      address: this.floor,
      abi: executeAbi,
      functionName: 'execute',
      args: [id, updateData, swap],
      value,
      account: this.account,
    } as const;
    await this.client.simulateContract(req as never);
    const estimate = await this.client.estimateContractGas(req as never);
    return this.wallet.writeContract({
      ...req,
      chain: this.chain,
      gas: scaleGas(estimate, gasMultiplier),
    } as never);
  }

  async sendExpire(id: bigint, gasMultiplier: number): Promise<Hex> {
    const req = {
      address: this.floor,
      abi: executeAbi,
      functionName: 'expire',
      args: [id],
      account: this.account,
    } as const;
    await this.client.simulateContract(req as never);
    const estimate = await this.client.estimateContractGas(req as never);
    return this.wallet.writeContract({
      ...req,
      chain: this.chain,
      gas: scaleGas(estimate, gasMultiplier),
    } as never);
  }

  /** Waits for a receipt; returns null on timeout (the tx may still land: check before resending). */
  async waitForFill(hash: Hex, timeoutMs: number): Promise<FillResult | null> {
    try {
      const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: timeoutMs });
      return withFill(receipt);
    } catch (err) {
      if (err instanceof Error && err.name === 'WaitForTransactionReceiptTimeoutError') return null;
      throw err;
    }
  }

  async receipt(hash: Hex): Promise<FillResult | null> {
    try {
      return withFill(await this.client.getTransactionReceipt({ hash }));
    } catch (err) {
      if (err instanceof Error && err.name === 'TransactionReceiptNotFoundError') return null;
      throw err;
    }
  }
}

export function scaleGas(estimate: bigint, multiplier: number): bigint {
  return (estimate * BigInt(Math.round(multiplier * 1000)) + 999n) / 1000n;
}

function withFill(receipt: TransactionReceipt): FillResult {
  const [log] = parseEventLogs({ abi: executeAbi, logs: receipt.logs, eventName: 'OrderFilled' });
  if (!log) return { receipt };
  const args = log.args as { amountOut: bigint; executorFee: bigint; priceE18: bigint };
  return {
    receipt,
    filled: { amountOut: args.amountOut, executorFee: args.executorFee, priceE18: args.priceE18 },
  };
}
