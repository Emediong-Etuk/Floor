import type { Address } from 'viem';

/**
 * Third-party contract addresses Floor talks to. Sources are in docs/addresses.md.
 * Floor's own deployments are read from env/config, never hardcoded here.
 */
export const MAINNET_CONTRACTS = {
  /** Pyth PriceFeed (same address on testnet): monad-crypto/protocols mainnet/pyth.jsonc */
  pyth: '0x2880aB155794e7179c9eE2e38200202908C17B43',
  /** 0x AllowanceHolder (Cancun+ chains incl. Monad): docs.0x.org 0x cheat sheet */
  zeroExAllowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734',
  /** Kuru Flow router (fallback venue): monad-crypto/protocols mainnet/kuru.jsonc */
  kuruFlowRouterV2: '0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2',
  permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
} as const satisfies Record<string, Address>;

export const TESTNET_CONTRACTS = {
  /** Pyth PriceFeed on testnet: docs.monad.xyz/tooling-and-infra/oracles */
  pyth: '0x2880aB155794e7179c9eE2e38200202908C17B43',
  /** Canonical testnet WMON: docs.monad.xyz/developer-essentials/testnets */
  wmon: '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541',
} as const satisfies Record<string, Address>;
