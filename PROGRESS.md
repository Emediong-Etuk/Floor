# PROGRESS

Living checklist. Update after every meaningful step.
Hackathon deadline: **about 2026-10-13 (Greg, 2026-10-10: "ends in 3 days"; exact time TBC)** · Team: **TODO** · Repo: github.com/Emediong-Etuk/floor

## Phase status

| Phase                    | Status                                          |
| ------------------------ | ----------------------------------------------- |
| 0: Recon and setup       | ✅ Done (2026-10-10)                            |
| 1: Contracts             | ✅ Done (2026-10-10), waiting on Greg's review  |
| 2: Deploy                | 🔨 Testnet ✅ (verified + smoke); mainnet waits |
| 3: Keeper                | 🔨 Testnet ✅ (fills in ~0.5 s); mainnet waits  |
| 4: Frontend MVP          | ✅ Built + e2e green; needs Privy id + Vercel   |
| 5: Notifications         | ✅ Built + tested; needs VAPID keys + Upstash   |
| 6: Polish and submission | —                                               |

## Phase 0 (2026-10-10)

Plan: read the Monad, Pyth and 0x docs → fill `docs/addresses.md` with sources → competitor
check → choose MVP tokens → scaffold the monorepo and CI → list perks.

Done:

- `docs/addresses.md`: networks, canonical contracts, MVP tokens, Pyth contract and feed ids,
  0x AllowanceHolder and endpoint, and Kuru, each with a source URL. Open items are listed
  with the phase that needs them.
- MVP tokens: WMON and WETH (cbBTC stretch) → USDC (D-002).
- Positioning note in `docs/pitch-outline.md`. We found no documented consumer stop-loss
  product on Monad. Greg still needs to check the App Hub by hand.
- Perks and accounts list in `docs/perks.md`.
- Monorepo:
  - Foundry project on Monad settings with OZ and forge-std submodules, plus a smoke test.
  - `@floor/shared`: chains and a token registry, with tests.
  - `@floor/keeper`: a validated config loader, with tests.
  - Prettier and CI.

Verify:

```bash
pnpm install && pnpm contracts:test && pnpm test && pnpm typecheck && pnpm lint
```

## Phase 1 (2026-10-10): contracts

Plan: oracle interface + PythAdapter (D-004 option C) → mocks → FloorOrders (§6.5 order exactly)
→ unit tests → Pyth tests on Pyth's MockPyth → hostile-venue tests → fuzz + invariants →
coverage and gas report.

Done:

- `IFloorOracle`, `PythAdapter` (exact-fee updates, empty update = no-op, expo conversion
  with bounds), `MockOracle` (operator for the /demo panel), `MockRouter` (spread +
  "liquidity gap"), `MockERC20` (capped faucet mint), `FloorMath` (shared conversion).
- `FloorOrders`: create, bracket (OCO), update, cancel (works while paused), execute,
  expire, views, admin. Per-token max oracle age (D-004). Executor gets `msg.value` minus the
  exact oracle fee back.
- 68 tests across six suites, all passing:
  - unit tests, plus hostile-venue tests (re-entrancy, short pay, third-party drain, over-pull,
    partial pull)
  - Pyth adapter and FloorOrders-on-Pyth tests, covering both price paths
  - fuzz tests (1,000 runs each)
  - an invariant suite: 256 runs × 64 calls, checking zero balances, active-set consistency,
    single bracket fill and the fee cap
  - mock tests
- Coverage: `FloorOrders.sol` 100% lines, 99% statements, 95% branches. `PythAdapter` and
  `FloorMath` 100%.
- Gas report: `docs/gas-report.md` (`execute` ≈ 300k, `createOrder` ≈ 313k).
- CI: the contracts job installs the Pyth SDK via pnpm and runs fmt, build, test and coverage.

Verify:

```bash
pnpm install && pnpm contracts:test
cd contracts && forge coverage --report summary --no-match-coverage "(test|script)"
```

## Phase 2 (2026-10-10): deploy scripts, part 1

Plan: shared mainnet config → DeployDemo / DeployLive → Smoke (create → cancel, plus a demo
fill) → rehearse on local anvil and on a mainnet fork → tests for CI → runbook.

Done:

- `script/DeployDemo.s.sol`, `script/DeployLive.s.sol` and `script/Smoke.s.sol`. Each deploy
  writes `deployments/<chainId>.json` for the keeper and app.
- `script/config/MonadMainnet.sol` holds the mainnet addresses and feed ids. A vitest test
  fails if it drifts from `@floor/shared`.
- Rehearsals, all passing:
  - `local-demo.sh`: deploy, then create/cancel, then a real fill (1,000 WMON crashed to
    $0.02 sold for 19.96 USDC).
  - `fork-live.sh`: deploy on a Monad mainnet fork, with real Pyth prices for all four feeds
    (21 s old, confidence under 0.1%), then create/cancel with real WMON.
- `test/Deploy.t.sol`:
  - the deploy wiring and a judge journey, which run in CI;
  - two mainnet-fork tests (real prices, $500 cap), which run when `MONAD_MAINNET_RPC_URL` is
    set and passed locally.
- Rehearsal transaction logs go to a git-ignored `broadcast-rehearsal/`, so a fork run can
  never look like a real mainnet deploy.
- Runbook: `docs/deploy.md`, covering gas and MON needed, verification and ownership handover.

### Testnet deploy (2026-10-10) ✅

- DeployDemo is on Monad testnet, and all 7 contracts are verified on MonadVision. Addresses
  and transactions are in `docs/addresses.md`.
- Smoke check on testnet: create → cancel worked, then a full fill (protect → crash → execute →
  19.94 USDC net). Confirmed independently with `cast`: order FILLED, active set empty,
  FloorOrders holds 0 tokens, price restored.
- The scripts now accept private keys with or without `0x`. Greg's env secret is bare hex.

Left for Phase 2: the mainnet deploy and smoke check (Greg's go-ahead, about 1.5 MON on
`0x1e2e9BCFaC764Ee6073EcFb50A707683df744eBF` or a separate mainnet key).

## Phase 3 (2026-10-10): keeper

Plan: shared ABIs + exact math mirror (shared vectors checked by Solidity and TS) → keeper
core (order tracking, prices, evaluate, fill, expire, notify) → /health and /metrics → unit
tests with a fake chain → anvil e2e → testnet e2e.

Done:

- `@floor/shared`:
  - ABIs generated from the Foundry build (`abi:sync`; CI runs `abi:check`).
  - `math.ts` mirrors FloorMath and the trigger, expiry, freshness and confidence rules.
  - `pyth.ts`: expo conversion and the Hermes response parser.
  - 300 shared `minOut` vectors, generated by Python big-int, checked by both
    `contracts/test/Vectors.t.sol` and vitest.
- Keeper (`keeper/src`), covering every responsibility in §7.1 in both modes:
  - order tracking: events plus a 30 s resync;
  - per-block evaluation;
  - fills: balance/allowance pre-check → MockRouter or 0x AllowanceHolder quote →
    liquidity wait → optional Hermes update and fee → simulate → gas × 1.15 → receipt;
  - idempotency: one fill in flight per order, never re-sent without a receipt check, local
    nonce manager;
  - revert decoding, expiry, notifications, `/health`, `/metrics`, pino logs.
  - It also reads `DEPLOYMENT_FILE` and accepts keys with or without `0x`.
- Tests: 33 keeper unit tests (fake chain, clients, evaluate, errors) plus 3 anvil e2e tests,
  which CI runs in the Foundry job.
- **Anvil:** fills 312–418 ms after the crash confirms (400 ms blocks).
- **Monad testnet** (`pnpm e2e:testnet`): **filled 474 ms after the crash confirmed** (keeper
  trigger → receipt: 804 ms). The OCO sibling was cancelled. Fill tx in `docs/keeper.md`.
- Runbook: `docs/keeper.md`.

Note: the testnet e2e used Greg's deployer key as keeper, user and price operator, because
no keeper key exists yet. It cost about 0.1 MON.

Left for Phase 3: the mainnet acceptance test (a tiny real fill through 0x). That needs the
mainnet deploy, a 0x API key and a funded mainnet keeper. Also: host the keeper always-on.

## Phase 4 (2026-10-10): app

Plan: fresh Next 16 app (D-005) → wallet abstraction (Privy; a local key on anvil only) →
read hooks → screens per §4 → server routes (faucet, demo price and gap, on-demand keeper
sweep, D-011) → Playwright e2e on anvil → CI.

Done:

- `app/`: Next 16.3.8, React 19, Tailwind 4, Privy 3.48 (email login, embedded wallet,
  Floor's own step UI with no Privy modals), TanStack Query, viem.
- Screens: welcome, home, protect (sliders, cash-out, advanced, plain-English summary,
  exact approval), protection detail (edit and cancel), activity (receipts with the tx found
  from the event), settings and `/demo`.
- Server routes: `/api/faucet`, `/api/demo/price`, `/api/demo/gap`, `/api/keeper/sweep` and
  `/api/keeper/status`. The on-demand sweep reuses the keeper code (`@floor/keeper/sweep`).
- E2E (`pnpm app:e2e`): Playwright at Pixel 7 size against a production build on anvil.
  - Flow tested: sign in → faucet → protect 1,000 WMON with a bracket → crash −20% → the
    keeper sells → Activity shows 19.94 USDC with the tx link.
  - Also tested: edit then cancel, and validation. 3/3 pass.
- Checked against the real testnet deployment: `/api/keeper/status`, `/api/demo/gap`,
  `/api/demo/price` (a 0% move) and `/api/keeper/sweep` all work with the server keys.
- CI: the app build runs in the TS job, and a new `app-e2e` job runs anvil + Playwright.
- Runbook and Vercel steps: `docs/app.md`.

Not done: native MON → WMON wrapping (live mode only; demo tokens are already ERC-20s), a
holdings API (Zerion; demo tokens aren't indexed, so balances come from on-chain reads), 24h
price change (the mock oracle has no history), and the PWA service worker (Phase 5, with
push).

## Phase 5 (2026-10-10): push notifications

Plan: push backend (store, signed subscribe, payloads, delivery) → service worker and
Settings toggle with the iOS install hint → PNG icons → tests.

Done:

- `public/sw.js`: push and notification-click handlers. Registered on load.
- `/api/push/subscribe` (wallet-signed: address + device hash + timestamp, valid for 10 min),
  `/api/push/unsubscribe` and `/api/notify` (Bearer `NOTIFY_SECRET`, for an always-on
  keeper). The on-demand sweep pushes its events directly.
- Storage: Upstash Redis over its REST API (free; the Vercel integration's `KV_*` names also
  work), with an in-memory fallback for local runs.
- UI: a "Sale alerts" card in Settings and after protecting. It covers the iOS "Add to Home
  Screen" case, blocked permission, and a deployment without push configured.
- PNG icons (192, 512, maskable, Apple touch) rendered from the SVG. The manifest is updated.
- Tests:
  - 8 app unit tests: signature proof (wrong wallet, wrong device, stale, garbage), payload
    text, delivery with dead-device cleanup, Upstash commands, and the subscribe and notify
    routes.
  - Playwright 4/4, now including a PWA check (manifest icons, service worker registered,
    alerts card).
  - A `web-push` encryption and VAPID check with a real key pair.

Not verified: a real push reaching a phone. That needs the deployed app with VAPID keys
(Android Chrome, or an installed iOS PWA). Phase 5's done-criterion is checked on Greg's
phone after the Vercel deploy.

## Blockers / needs Greg

1. **Mainnet deploy:** Greg's go-ahead plus about 1.5 mainnet MON on the deployer. Ideally use
   a separate mainnet-only key; tiny real funds only.
2. **Deploy the app (Phase 4):** a Privy App ID (dashboard.privy.io, email login, add the
   Vercel domain), then a Vercel project with root `app` and the env vars in `docs/app.md`.
   The keeper key exists (15 MON). No paid keeper host is needed (D-011). For push: run
   `pnpm --filter @floor/app vapid` once, add the two keys and `VAPID_SUBJECT`, and connect
   Vercel Storage → Upstash Redis (free). Then turn on alerts on your phone and run a demo
   crash.
3. Exact submission time and team, for PROGRESS.md and the schedule.
4. Commit the build prompt as `FLOOR_BUILD_PROMPT.md` at the repo root, so every session can
   read the spec.
5. Claim the QuickNode perk and make a 0x dashboard account before the mainnet deploy (`docs/perks.md`).
6. Five minutes on the Monad App Hub and Kuru Pro for existing TP/SL features
   (`docs/pitch-outline.md`).

## Decisions

See `docs/DECISIONS.md`: D-001 toolchain · D-002 tokens · D-003 0x AllowanceHolder ·
D-004 price source (C) · D-005 frontend base (fresh Next 16) · D-006 chain defs · D-007 branching ·
D-008 Pyth SDK via npm · D-009 Phase 1 contract details · D-010 keeper design ·
D-011 on-demand keeper (free hosting).
