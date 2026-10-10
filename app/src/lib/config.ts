import { defineChain, type Address, type Chain } from 'viem';
import { chainFor } from '@floor/shared';
import deployments from './deployments.json';

/**
 * Public app config. Addresses come from contracts/deployments (synced into deployments.json)
 * or, for local e2e runs, from NEXT_PUBLIC_DEPLOYMENT. Nothing is hand-typed here.
 */
export interface Deployment {
  mode: 'demo' | 'live';
  chainId: number;
  floorOrders: Address;
  oracle: Address;
  swapTarget: Address;
  owner?: Address;
  tokens: Record<string, Address>;
}

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '10143');
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
const defaultRpc = CHAIN_ID === 143 ? 'https://rpc.monad.xyz' : 'https://testnet-rpc.monad.xyz';
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || defaultRpc;

const override = process.env.NEXT_PUBLIC_DEPLOYMENT;
export const deployment: Deployment = override
  ? (JSON.parse(override) as Deployment)
  : ((deployments as Record<string, Deployment>)[String(CHAIN_ID)] as Deployment);
if (!deployment) throw new Error(`No Floor deployment for chain ${CHAIN_ID}`);

export const chain: Chain =
  CHAIN_ID === 31_337
    ? defineChain({
        id: 31_337,
        name: 'Anvil',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
      })
    : chainFor(CHAIN_ID);

export const EXPLORER = chain.blockExplorers?.default.url ?? '';
export const FAUCET_URL = 'https://faucet.monad.xyz';

export interface TokenMeta {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  /** Can be protected (sold). USDC is the settlement token. */
  protectable: boolean;
}

// Decimals are fixed by DeployDemo / the mainnet token list (docs/addresses.md).
const META: Record<string, { name: string; decimals: number }> = {
  WMON: { name: 'MON', decimals: 18 },
  WETH: { name: 'Ether', decimals: 18 },
  cbBTC: { name: 'Bitcoin', decimals: 8 },
  USDC: { name: 'USD Coin', decimals: 6 },
};

export const TOKENS: TokenMeta[] = Object.entries(deployment.tokens)
  .filter(([symbol]) => META[symbol])
  .map(([symbol, address]) => ({
    symbol,
    address,
    name: META[symbol]!.name,
    decimals: META[symbol]!.decimals,
    protectable: symbol !== 'USDC',
  }))
  .sort(
    (a, b) =>
      ['WMON', 'WETH', 'cbBTC', 'USDC'].indexOf(a.symbol) -
      ['WMON', 'WETH', 'cbBTC', 'USDC'].indexOf(b.symbol),
  );

export const USDC = TOKENS.find((t) => t.symbol === 'USDC')!;

export function tokenByAddress(address: string): TokenMeta | undefined {
  return TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
}

export function tokenBySymbol(symbol: string): TokenMeta | undefined {
  return TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
