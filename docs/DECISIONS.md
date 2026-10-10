# Decisions

Each entry gives the decision, the reason and its status. "Open" means Greg has to decide.

## D-001 Toolchain pins (2026-10-10, decided)

| Tool                       | Version                         | Why                                                                                                                                                  |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry                    | 1.8.1                           | Monad docs require ≥ 1.8.0 for Monad execution (`network = "monad"`). The `stable` release tag still points at 1.5.1, so pin the version explicitly. |
| solc                       | 0.8.30                          | Mature and widely used, and it defaults to Prague. 0.8.37 is out, but nothing in it is needed.                                                       |
| `evm_version`              | `prague`                        | Monad supports EIP-7702 (Prague). The Monad docs don't say whether Osaka-only opcodes (e.g. CLZ) work, so we don't emit them.                        |
| OpenZeppelin               | v5.7.0 (git submodule)          | Current release. Provides `Ownable2Step`, `ReentrancyGuard`, `Pausable`, `SafeERC20` and `Math.mulDiv`.                                              |
| forge-std                  | v1.9.7 (git submodule)          | Current release.                                                                                                                                     |
| Node / pnpm                | 22 / 10.28.0                    | Same as Greg's other repos.                                                                                                                          |
| TypeScript                 | 5.9.3                           | TypeScript 7 (the native Go compiler) is `latest` on npm, but Next.js and the wagmi tooling are proven on 5.9. Revisit after the hackathon.          |
| viem / zod / vitest / pino | 2.57.4 / 4.6.5 / 5.0.3 / 10.4.0 | Current releases.                                                                                                                                    |

Pyth's Solidity SDK (`@pythnetwork/pyth-sdk-solidity` 4.3.1, which includes `MockPyth`) is
added in Phase 1 alongside `PythAdapter`.

## D-002 MVP token set (2026-10-10, decided; Greg can veto)

WMON and WETH can be protected, and they sell into USDC. cbBTC is a third token if time allows.

- All four tokens are in the official token list and have Pyth sponsored feeds on Monad mainnet.
- Kuru has live MON/USDC, WETH/USDC and cbBTC/USDC markets, and 0x routes through Kuru, so
  there is real liquidity for the sell.
- Together they cover 18-decimal and 8-decimal inputs and a 6-decimal output, which is exactly
  the decimals matrix the tests need.
- WETH is priced with the ETH/USD premium feed (0.02% deviation) rather than the WETH/USD
  standard feed (0.05%). The README notes the depeg caveat.
- A real 0x quote per pair is still needed (Phase 2, once there's a 0x key). Any pair that
  can't fill $500 within 1% gets dropped.

## D-003 Execution through 0x AllowanceHolder (2026-10-10, decided)

In live mode the swap target allowlist holds exactly one entry:
`(target = AllowanceHolder, spender = AllowanceHolder)`, both at
`0x0000000000001fF3684f28c67538d4D072C22734`.

- 0x recommends AllowanceHolder over Permit2 for integrators, and it needs no signatures, which
  suits a contract taker.
- Settler addresses rotate, so Settler is **never** allowlisted.
- Security note for Phase 1: the executor fully controls the `exec(operator, token, amount,
target, data)` arguments sent to AllowanceHolder. In the worst case they route it so their
  own contract pulls this order's `amountIn` of `tokenIn`. The transient approval
  (`forceApprove` to `amountIn`, then reset to 0) exposes nothing more, and FloorOrders holds no
  balances between calls. The `received ≥ minOut` check still applies, so the worst outcome is
  a sale at the oracle-derived `minOut`. That is the README claim that "a malicious executor is
  bounded by `maxSlippageBps`". `MaliciousRouter` tests cover it.
- 0x does not support Monad testnet, so demo mode uses `MockRouter`, as the spec says.
- The keeper passes `taker = FloorOrders` and `txOrigin = keeper EOA`. 0x needs `txOrigin`
  when the taker is a contract.

## D-004 Where live-mode prices come from (2026-10-10, **open: Greg decides**)

What changed since the build prompt was written: since Pyth's 2026-08-26 upgrade, **Hermes
requires an API key** (free trial, then paid plans). The prompt's live design pulls a Hermes
update into every `execute`.

Pyth also runs **sponsored push feeds** on Monad mainnet against the same PriceFeed contract
(`mainnet/pyth.jsonc`):

- MON, ETH and BTC: 1h heartbeat, 0.02% deviation.
- USDC and cbBTC: 1h heartbeat, 0.05% deviation.

Those feeds update onchain whenever the price moves more than the deviation threshold, at no
cost to us.

| Option                                              | Freshness                                                     | Cost / accounts                  | Contract impact                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Hermes pull on every execute (the prompt's plan) | ~400 ms                                                       | Pyth account; trial, then paid   | `maxOracleAge` = 15 s                                                                                                                          |
| B. Sponsored push feeds only                        | within 0.02–0.05% of market, as long as Pyth's pusher is live | none                             | `update()` is a no-op. Freshness is set per token: `maxOracleAge` ≈ heartbeat + margin.                                                        |
| **C. Both (recommended)**                           | A when a key is configured, else B                            | none required; a key improves it | `PythAdapter.update` accepts an empty array. Staleness is set per token (spec §6.4 already has `setMaxOracleAge`; Phase 1 makes it per token). |

Recommendation: **C**. It ships without a paid dependency and keeps the 400 ms story for the
pitch if Greg takes the free trial. It needs Greg's OK because it changes §6.4 (a per-token
max age) and §7 (Hermes becomes optional).

## D-005 Frontend base (2026-10-10, **open: decide before Phase 4**)

The recommended Monad template
([`monad-developers/next-serwist-privy-0x`](https://github.com/monad-developers/next-serwist-privy-0x))
uses Next 14.2, React 18 and Tailwind 3, and calls 0x's Permit2 endpoints.

Recommendation: start a fresh Next 16 / React 19 / Tailwind 4 app in `app/`. Port the
template's Privy provider, Serwist service worker and web-push routes, which are its useful
parts. Don't upgrade the template in place. Floor also never calls 0x from the browser: only
the keeper uses 0x.

## D-006 Chain definitions live in `@floor/shared` (2026-10-10, decided)

viem's built-in `monadTestnet` points at a retired explorer, and its Multicall3
`blockCreated` dates from before the 2025-12-16 testnet reset. `packages/shared/src/chains.ts`
defines both chains from the Monad docs.

## D-007 Branching (2026-10-10, decided)

Work happens on `claude/magical-albattani-fh3lg4` and merges into `main` by PR, so `main`
only ever has CI-green work.
