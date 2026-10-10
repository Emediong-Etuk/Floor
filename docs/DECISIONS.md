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

## D-004 Where live-mode prices come from (2026-10-10, **decided: option C**, Greg)

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

**Decision (Greg, 2026-10-10): option C.** What this changes in the spec:

- §6.2: `PythAdapter.update([])` is a no-op that refunds `msg.value`, and `updateFee([])` is 0.
  With data, the adapter pays exactly Pyth's fee and refunds the rest.
- §6.4: `setMaxOracleAge(uint32)` stays as the global default (15 s). A new
  `setTokenMaxOracleAge(token, uint32)` overrides it per token (0 = use the default). Push-only
  live config: about 3900 s per token (1 h heartbeat + margin). With a Hermes key: back to 15 s.
- §7: the keeper attaches a Hermes update only when `HERMES_URL` and `HERMES_API_KEY` are set.
  Otherwise it sends an empty `priceUpdate`.
- §6.5 step 2: `FloorOrders` forwards exactly `updateFee(priceUpdate)` to the oracle and
  refunds the rest of `msg.value` to the executor. (Pyth keeps overpayments, so we never send
  more than the fee.)

## D-005 Frontend base (2026-10-10, **decided: fresh Next 16 app**)

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

## D-008 Pyth Solidity SDK from npm (2026-10-10, decided)

`@pythnetwork/pyth-sdk-solidity` 4.3.1 is a dev dependency of `contracts/package.json` (a pnpm
workspace package) and is remapped in `foundry.toml`. Pyth publishes the SDK on npm. Its git
home is the very large `pyth-crosschain` monorepo, so a submodule would be slow. The SDK's
`MockPyth` drives the adapter tests. This means `pnpm install` has to run before
`forge build`, and CI does that.

## D-009 Phase 1 contract details (2026-10-10, decided; flag anything Greg disagrees with)

- **Bracket allowance:** a bracket needs an allowance of `amountIn` once, not twice, because
  only one leg can ever fill. The app's "approve exactly" sum counts a bracket once.
- **Order ids** start at 1, so `linkedOrderId = 0` means "no sibling".
- **`checkTrigger`** reads the cached price and ignores freshness and confidence (the keeper
  may bring a fresh update). `execute` enforces both.
- **Token decimals** (≤ 18) are cached when a token is allowlisted. A token can't be
  allowlisted while it's a venue, and a venue can't be added while it's a token.
- **Delisting** a token blocks `execute` for its orders. Users can still cancel.
- **Expiry is per leg.** `expire()` closes one order. Both legs of a bracket share the expiry
  they were created with.
- **Pyth publish times ahead of the block timestamp** count as age 0. Monad blocks are
  ~400 ms but timestamps are whole seconds.
- **`maxSlippageBps = 0` is allowed.** It just never fills against a venue with any spread.
- **Lint warnings accepted by design** (`forge lint src`):
  - `arbitrary-send-erc20`: `transferFrom(owner)` is the product.
  - `arbitrary-send-eth`: refunds go to the executor.
  - `block-timestamp`: expiry and oracle age.
  - `reentrancy-events`: all state-changing entry points are `nonReentrant`.
  - `missing-zero-check` on the mocks' `setOperator`: 0 disables the operator.

## D-010 Keeper design (2026-10-10, decided)

- **Notify auth** uses `Authorization: Bearer <NOTIFY_SECRET>` on POST `/api/notify`. The
  app's route (Phase 5) must check this header.
- **Notification types:** `selling` (tx sent), `filled` (amounts and latency),
  `waiting-liquidity` (once per trigger episode) and `unfillable` (once until it recovers).
- **Latency** is measured from the keeper first seeing the trigger to its receipt. The
  testnet e2e also reports the wall time from the crash confirming to FILLED.
- **Blocks and events:** websocket subscriptions when `RPC_WS_URL` is set, otherwise HTTP
  polling every 400 ms. viem falls back from `eth_newFilter` to `eth_getLogs` where filters
  aren't supported.
- **Reads:** prices for all tokens in one Multicall3 call per block. Anvil has no Multicall3,
  so local runs fall back to parallel `eth_call`s.
- **Hermes:** REST polling with a 1 s cache. SSE streaming is deferred until there's a key.
- **Pending transactions:** with no receipt after 2 min, a tx is treated as dropped and the
  order may be retried. There's no automatic speed-up or replacement: Monad has no global
  mempool, and a stuck nonce is rare at 400 ms blocks.
- **Overlapping ticks** are skipped, not queued. Fills run concurrently, but only one per
  order at a time.

## D-011 On-demand keeper in the app (2026-10-10, decided: Greg)

Greg has no budget for paid always-on hosting. On testnet, prices only move when the `/demo`
panel moves them (MockOracle). So the app's serverless routes run one keeper sweep right
after each price move, and after each new protection, using the same `Keeper` code as the
always-on process (`@floor/keeper/sweep`). The fill is just as real on-chain, and it usually
lands within about a second of the price move.

- Keys live in Vercel server env vars (`DEMO_OPERATOR_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`).
  These are testnet only and never `NEXT_PUBLIC_*`.
- Limitation, stated in the README: this doesn't watch real market prices around the clock.
  Live mode on mainnet needs the always-on keeper (`pnpm keeper:start`), for example on
  Greg's laptop during a recorded live demo.
- Concurrent sweeps on one instance share the pass in progress. Across instances, two
  sweeps can race. That's safe, because the contract only lets an order fill once (the loser
  gets `NotActive`).
