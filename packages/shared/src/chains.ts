import { defineChain } from 'viem';

/**
 * Monad chain definitions. Values come from the official network-information pages
 * (sources in docs/addresses.md), not from viem's built-ins: viem's testnet entry still
 * points at the old explorer, and the testnet was reset from genesis on 2025-12-16.
 *
 * Mainnet: https://docs.monad.xyz/developer-essentials/network-information
 * Testnet: https://docs.monad.xyz/developer-essentials/testnets
 */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

export const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  blockTime: 400,
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    // Public endpoints are rate-limited (25 rps). The keeper must use a dedicated RPC.
    default: { http: ['https://rpc.monad.xyz'], webSocket: ['wss://rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://monadvision.com' },
    monadscan: { name: 'Monadscan', url: 'https://monadscan.com' },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: false,
});

export const monadTestnet = defineChain({
  id: 10_143,
  name: 'Monad Testnet',
  blockTime: 400,
  nativeCurrency: { name: 'Testnet MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.monad.xyz'],
      webSocket: ['wss://testnet-rpc.monad.xyz'],
    },
  },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' },
    monadscan: { name: 'Monadscan', url: 'https://testnet.monadscan.com' },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

export const TESTNET_FAUCET_URL = 'https://faucet.monad.xyz';

export type SupportedChainId = typeof monadMainnet.id | typeof monadTestnet.id;

export function chainFor(chainId: number) {
  if (chainId === monadMainnet.id) return monadMainnet;
  if (chainId === monadTestnet.id) return monadTestnet;
  throw new Error(
    `Unsupported chain id ${chainId}; Floor runs on Monad (143) and Monad testnet (10143)`,
  );
}
