# Addresses, feed ids and endpoints

Every value here comes from an official source, linked next to it. Checked on **2026-10-10**.
Re-check before each deploy. The same values live in code in `packages/shared/src/` (tokens,
third-party contracts, chains). Floor's own deployments are recorded in the last section after
Phase 2.

Status legend: ✅ verified from the source · ⚠️ verified, but read the note · 🔲 not known yet (filled in a later phase).

## Networks

| Item                  | Mainnet                                                                                                                            | Testnet                                                                                                                             | Source                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain ID              | `143` ✅                                                                                                                           | `10143` ✅                                                                                                                          | [mainnet](https://docs.monad.xyz/developer-essentials/network-information), [testnet](https://docs.monad.xyz/developer-essentials/testnets) |
| Public RPC (HTTP/WSS) | `https://rpc.monad.xyz` / `wss://rpc.monad.xyz` (QuickNode, 25 rps) ✅                                                             | `https://testnet-rpc.monad.xyz` / `wss://testnet-rpc.monad.xyz` (QuickNode, 50 rps; 25 rps for `eth_call` and `eth_estimateGas`) ✅ | same                                                                                                                                        |
| Other public RPCs     | `rpc1` (Alchemy, 15 rps), `rpc2` (Goldsky, 300/10s), `rpc3` (Ankr, 300/10s) `.monad.xyz`, `rpc-mainnet.monadinfra.com` (20 rps) ✅ | `rpc.ankr.com/monad_testnet`, `rpc-testnet.monadinfra.com` ✅                                                                       | same                                                                                                                                        |
| Explorers             | https://monadvision.com, https://monadscan.com ✅                                                                                  | https://testnet.monadvision.com, https://testnet.monadscan.com ✅                                                                   | same                                                                                                                                        |
| Faucet                | n/a                                                                                                                                | https://faucet.monad.xyz ✅                                                                                                         | testnet page                                                                                                                                |

⚠️ The testnet was reset from genesis on 2025-12-16 (testnet page). viem's built-in `monadTestnet`
still points at the old `testnet.monadexplorer.com`, so `packages/shared/src/chains.ts` defines
the chains itself.

The public RPCs are rate-limited. The keeper must use a dedicated provider (see the perks list
in `docs/perks.md`).

## Canonical contracts

| Contract   | Mainnet                                         | Testnet                                         | Source                          |
| ---------- | ----------------------------------------------- | ----------------------------------------------- | ------------------------------- |
| WMON       | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` ✅ | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` ✅ | network-information pages above |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` ✅ | same ✅                                         | same                            |
| Permit2    | `0x000000000022d473030f116ddee9f6b43ac78ba3` ✅ | same ✅                                         | same                            |
| CreateX    | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` ✅ | same ✅                                         | same                            |

## Tokens (mainnet MVP set)

Source: [monad-crypto/token-list `tokenlist-mainnet.json`](https://raw.githubusercontent.com/monad-crypto/token-list/refs/heads/main/tokenlist-mainnet.json)
(list timestamp 2026-10-02). The list itself says inclusion is not an endorsement. These four
are the canonical bridged assets with Kuru markets (next section).

| Symbol | Address                                         | Decimals | Bridge         | Role                    |
| ------ | ----------------------------------------------- | -------- | -------------- | ----------------------- |
| WMON   | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` ✅ | 18       | native wrap    | protect (sell)          |
| WETH   | `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` ✅ | 18       | Wormhole NTT   | protect (sell)          |
| cbBTC  | `0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b` ✅ | 8        | Chainlink CCIP | protect (sell), stretch |
| USDC   | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` ✅ | 6        | Circle CCTP    | settlement (buy)        |

Also listed, not in the MVP: WBTC `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` (8, LayerZero
OFT), USDT0 `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` (6), AUSD
`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (6).

Testnet tokens from `tokenlist-testnet.json`: USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`
(6), WETH `0x45477f4709771331db81944A5E20eF95Bc7BA2D7` (18), WMON (above). Demo mode doesn't
use them. It deploys `MockERC20` tokens with a public mint so judges can fund themselves (§6.7).

## Oracle: Pyth

| Item                               | Value                                                                 | Source                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Pyth PriceFeed, mainnet            | `0x2880aB155794e7179c9eE2e38200202908C17B43` ✅                       | [protocols `mainnet/pyth.jsonc`](https://github.com/monad-crypto/protocols/blob/main/mainnet/pyth.jsonc) |
| Pyth PriceFeed, testnet            | `0x2880aB155794e7179c9eE2e38200202908C17B43` ✅ (same address)        | [Monad oracles page](https://docs.monad.xyz/tooling-and-infra/oracles)                                   |
| Old beta contract (do **not** use) | `0xad2B52D2af1a9bD5c561894Cdd84f7505e1CD0B5`                          | oracles page: "no longer serves this feed"                                                               |
| Hermes (pull updates)              | `https://pyth.dourolabs.app/hermes`, `Authorization: Bearer <key>` ⚠️ | [Pyth upgrade notice](https://docs.pyth.network/price-feeds/core/upgrade/preparing)                      |

⚠️ **Hermes needs an API key now.** Since Pyth's 2026-08-26 upgrade, `hermes.pyth.network`
requires authentication. Keys come with a free trial and paid plans
([pythdata.app/signup](https://pythdata.app/signup)). This affects the live-mode design. See
`docs/DECISIONS.md` D-004.

**Feed ids** (from `mainnet/pyth.jsonc`). Pyth runs _sponsored push_ updates for these feeds on
Monad mainnet, so prices land onchain without us posting them:

| Feed      | Id                                                                      | Push tier (heartbeat / deviation) |
| --------- | ----------------------------------------------------------------------- | --------------------------------- |
| MON/USD   | `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1` ✅ | premium: 1h / 0.02%               |
| ETH/USD   | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` ✅ | premium: 1h / 0.02%               |
| BTC/USD   | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` ✅ | premium: 1h / 0.02%               |
| CBBTC/USD | `0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97` ✅ | standard: 1h / 0.05%              |
| USDC/USD  | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` ✅ | standard: 1h / 0.05%              |
| WETH/USD  | `0x9d4294bbcd1174d6f2003ec365831e64cc31d9f6f15a2b85399db8d5000960f6` ✅ | standard: 1h / 0.05%              |
| WBTC/USD  | `0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33` ✅ | standard: 1h / 0.05%              |

The full canonical list: [Pyth push feeds (EVM), Monad section](https://docs.pyth.network/price-feeds/core/push-feeds/evm).
Floor prices WETH with ETH/USD (the tighter premium tier). That feed tracks ETH, so a WETH depeg
would not show up in it, which is acceptable for a wrapped-asset MVP and is noted in the README.

## Execution: 0x Swap API (live mode)

| Item                          | Value                                                                                                                                                       | Source                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monad support                 | chain `143` ✅. Testnet `10143` is **not** supported.                                                                                                       | [0x supported chains](https://docs.0x.org/docs/introduction/supported-chains)                                                                                                         |
| Quote endpoint                | `GET https://api.0x.org/swap/allowance-holder/quote` ✅                                                                                                     | [AllowanceHolder getQuote](https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getquote)                                                                                 |
| Headers                       | `0x-api-key: <key>` (required, from dashboard.0x.org), `0x-version: v2` ✅                                                                                  | same                                                                                                                                                                                  |
| Key params                    | `chainId`, `sellToken`, `buyToken`, `sellAmount`, `taker` (= FloorOrders), `txOrigin` (= keeper EOA, needed because the taker is a contract), `slippageBps` | same                                                                                                                                                                                  |
| AllowanceHolder               | `0x0000000000001fF3684f28c67538d4D072C22734` ✅ (all Cancun chains incl. Monad)                                                                             | [0x cheat sheet](https://docs.0x.org/docs/core-concepts/0x-cheat-sheet), [protocols `mainnet/matcha.jsonc`](https://github.com/monad-crypto/protocols/blob/main/mainnet/matcha.jsonc) |
| MonadSettler (reference only) | `0x478cF28Fd1Ba92a6afd04F44b05833F6dF7f1486`                                                                                                                | `matcha.jsonc`. Settler addresses rotate, so never allowlist Settler directly. Allowlist AllowanceHolder.                                                                             |
| Liquidity on Monad            | Kuru, Crystal, Clober, OctoSwap, Atlantis, iZiSwap, Intro, Morpheus, LFJ, Uniswap                                                                           | 0x "build on Monad" page (via search, 2026-10-10)                                                                                                                                     |

With AllowanceHolder, the quote's `transaction.to` and `issues.allowance.spender` are both the
AllowanceHolder address. The keeper checks that both equal the configured value before sending.

## Fallback venue: Kuru

Source: [protocols `mainnet/kuru.jsonc`](https://github.com/monad-crypto/protocols/blob/main/mainnet/kuru.jsonc).

| Contract           | Address                                         |
| ------------------ | ----------------------------------------------- |
| KuruFlowEntryPoint | `0xb3e6778480b2E488385E8205eA05E20060B813cb` ✅ |
| KuruFlowRouterV2   | `0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2` ✅ |
| Router (CLOB)      | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` ✅ |
| Market MON/USDC    | `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` ✅ |
| Market WETH/USDC   | `0xa6aFD386135B7D41A6C40C525abC4A1019b0D132` ✅ |
| Market cbBTC/USDC  | `0x40c49f171202f91ff5d2fae34c22dd2bfdd22af0` ✅ |

These markets are why the MVP token set is WMON, WETH and cbBTC to USDC. 0x already routes
through Kuru, so a direct Kuru integration is stretch goal 8 only.

## Endpoints still to confirm (need Greg's accounts)

| Item                                                      | Why it's open                                                                                     | Phase           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| 0x API key, plus a real quote for WMON to USDC on 143     | needs a dashboard.0x.org account                                                                  | 2 (live deploy) |
| Pyth API key (only if we use Hermes; see D-004)           | needs a Pyth account, free trial then paid                                                        | 2–3             |
| Dedicated RPC URLs (HTTP + WSS)                           | perk claim (QuickNode / Dwellir / Spectrum)                                                       | 2               |
| Privy app id                                              | Privy dashboard                                                                                   | 4               |
| Zerion API key                                            | perk claim                                                                                        | 4               |
| Contract verification endpoints (MonadVision / Monadscan) | read the [verify guide](https://docs.monad.xyz/guides/verify-smart-contract/index) at deploy time | 2               |

## Floor deployments

🔲 Filled in Phase 2: FloorOrders, MockOracle / PythAdapter, MockRouter and the MockERC20s on
testnet, and FloorOrders and PythAdapter on mainnet. Each entry gets its explorer link and deploy
transaction.
