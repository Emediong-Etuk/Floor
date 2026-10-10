import type { Address, Hex } from 'viem';

/**
 * MVP token registry for live mode (Monad mainnet). Every value is copied from an
 * official source listed in docs/addresses.md:
 * - token addresses/decimals: https://github.com/monad-crypto/token-list (tokenlist-mainnet.json)
 * - Pyth feed ids: https://github.com/monad-crypto/protocols/blob/main/mainnet/pyth.jsonc
 *
 * Demo mode (testnet) uses MockERC20 tokens deployed in Phase 2; they are not listed here.
 */
export interface TokenInfo {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  /** Pyth price feed id used to price this token in USD. */
  pythFeedId: Hex;
  /** Pyth feed the id refers to, for humans reading logs. */
  pythFeed: string;
  /** 'in' = can be protected (sold); 'out' = settlement asset. */
  role: 'in' | 'out';
}

export const MAINNET_TOKENS = {
  WMON: {
    symbol: 'WMON',
    name: 'Wrapped MON',
    address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    decimals: 18,
    pythFeedId: '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1',
    pythFeed: 'MON/USD',
    role: 'in',
  },
  WETH: {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    address: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242',
    decimals: 18,
    // ETH/USD (premium sponsored feed: 0.02% deviation) rather than WETH/USD (standard: 0.05%).
    pythFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    pythFeed: 'ETH/USD',
    role: 'in',
  },
  CBBTC: {
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    address: '0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b',
    decimals: 8,
    pythFeedId: '0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97',
    pythFeed: 'CBBTC/USD',
    role: 'in',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USDC',
    address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    decimals: 6,
    // USDC is priced from its own feed, never hardcoded to $1 (build prompt §6.5 step 3).
    pythFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    pythFeed: 'USDC/USD',
    role: 'out',
  },
} as const satisfies Record<string, TokenInfo>;

export type MainnetTokenKey = keyof typeof MAINNET_TOKENS;
