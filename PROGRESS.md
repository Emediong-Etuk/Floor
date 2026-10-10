# PROGRESS

Living checklist. Update after every meaningful step.
Hackathon deadline: **TODO: Greg to fill in** · Team: **TODO** · Repo: github.com/Emediong-Etuk/floor

## Phase status

| Phase                    | Status                                         |
| ------------------------ | ---------------------------------------------- |
| 0: Recon and setup       | ✅ Done (2026-10-10)                           |
| 1: Contracts             | ✅ Done (2026-10-10), waiting on Greg's review |
| 2: Deploy                | ⏳ Next (needs a funded testnet deployer key)  |
| 3: Keeper                | —                                              |
| 4: Frontend MVP          | — (D-005 open)                                 |
| 5: Notifications         | —                                              |
| 6: Polish and submission | —                                              |

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

## Blockers / needs Greg

1. **Phase 2 testnet deploy:** a deployer key funded with testnet MON (faucet.monad.xyz needs a
   human). Add it as the environment secret `FLOOR_DEPLOYER_PRIVATE_KEY`, or deploy locally
   with the script once it's written. The keeper key is separate and needs more than 10 MON.
2. Hackathon deadline and team, for PROGRESS.md and the schedule.
3. Commit the build prompt as `FLOOR_BUILD_PROMPT.md` at the repo root, so every session can
   read the spec.
4. Claim the QuickNode perk and make a 0x dashboard account before Phase 2 (`docs/perks.md`).
5. Five minutes on the Monad App Hub and Kuru Pro for existing TP/SL features
   (`docs/pitch-outline.md`).

## Decisions

See `docs/DECISIONS.md`: D-001 toolchain · D-002 tokens · D-003 0x AllowanceHolder ·
D-004 price source (C) · D-005 frontend base (open) · D-006 chain defs · D-007 branching ·
D-008 Pyth SDK via npm · D-009 Phase 1 contract details.
