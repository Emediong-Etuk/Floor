# PROGRESS

Living checklist. Update after every meaningful step.
Hackathon deadline: **TODO: Greg to fill in** · Team: **TODO** · Repo: github.com/Emediong-Etuk/floor

## Phase status

| Phase                    | Status                                         |
| ------------------------ | ---------------------------------------------- |
| 0: Recon and setup       | ✅ Done (2026-10-10), waiting on Greg's review |
| 1: Contracts             | ⏳ Next, after Greg answers D-004              |
| 2: Deploy                | —                                              |
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

## Blockers / needs Greg

1. **D-004 (decide before Phase 1):** Pyth Hermes now needs an API key. Recommended:
   option C, which uses sponsored push feeds by default and Hermes when a key is set.
2. Hackathon deadline and team, for PROGRESS.md and the schedule.
3. Commit the build prompt as `FLOOR_BUILD_PROMPT.md` at the repo root, so every session can
   read the spec.
4. Claim the QuickNode perk and make a 0x dashboard account before Phase 2 (`docs/perks.md`).
5. Five minutes on the Monad App Hub and Kuru Pro for existing TP/SL features
   (`docs/pitch-outline.md`).

## Decisions

See `docs/DECISIONS.md`: D-001 toolchain · D-002 tokens · D-003 0x AllowanceHolder ·
D-004 price source (open) · D-005 frontend base (open) · D-006 chain defs · D-007 branching.
