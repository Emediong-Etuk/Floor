# PROGRESS

Living checklist. Update after every meaningful step.
Hackathon deadline: **TODO: Greg to fill in** · Team: **TODO** · Repo: github.com/Emediong-Etuk/floor

## Phase status

| Phase                    | Status                                          |
| ------------------------ | ----------------------------------------------- |
| 0: Recon and setup       | ✅ Done (2026-10-10)                            |
| 1: Contracts             | ✅ Done (2026-10-10), waiting on Greg's review  |
| 2: Deploy                | 🔨 Testnet ✅ (verified + smoke); mainnet waits |
| 3: Keeper                | —                                               |
| 4: Frontend MVP          | — (D-005 open)                                  |
| 5: Notifications         | —                                               |
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

## Blockers / needs Greg

1. **Mainnet deploy:** Greg's go-ahead plus about 1.5 mainnet MON on the deployer. Ideally use
   a separate mainnet-only key; tiny real funds only.
2. **Keeper key (Phase 3):** a separate testnet key with more than 10 MON (Monad reserve
   balance), as the env secret `KEEPER_PRIVATE_KEY`.
3. Hackathon deadline and team, for PROGRESS.md and the schedule.
4. Commit the build prompt as `FLOOR_BUILD_PROMPT.md` at the repo root, so every session can
   read the spec.
5. Claim the QuickNode perk and make a 0x dashboard account before the mainnet deploy (`docs/perks.md`).
6. Five minutes on the Monad App Hub and Kuru Pro for existing TP/SL features
   (`docs/pitch-outline.md`).

## Decisions

See `docs/DECISIONS.md`: D-001 toolchain · D-002 tokens · D-003 0x AllowanceHolder ·
D-004 price source (C) · D-005 frontend base (open) · D-006 chain defs · D-007 branching ·
D-008 Pyth SDK via npm · D-009 Phase 1 contract details.
