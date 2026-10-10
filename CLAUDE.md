# CLAUDE.md: Floor project memory

Read this first in every session, then `PROGRESS.md` (live status) and the master build prompt
`FLOOR_BUILD_PROMPT.md` (phases are in its §12). Decisions are in `docs/DECISIONS.md`.

## Product in one paragraph

Floor is an automatic stop-loss and take-profit app for casual crypto holders on Monad, and
works mobile-first. A user sets a floor price (and optionally a cash-out price) on a token they hold. If the
oracle price crosses it, anyone (usually our keeper) can call `FloorOrders.execute`, which
checks the trigger against Pyth, sells through an allowlisted venue (0x AllowanceHolder live,
MockRouter in demo) and enforces an oracle-derived `minOut`. Tokens stay in the user's wallet
until the order fires. Hackathon: Monad Metropolis, track Onchain Finance & Trading.

## Non-negotiables

1. Real onchain logic. The UI never fakes transactions or state.
2. Never invent addresses, feed ids, endpoints or chain parameters. Use `docs/addresses.md`
   (every value has a source URL) or `TODO(verify): <what> — <where>`.
3. Security rules in build prompt §6.6 are mandatory, the swap-target allowlist above all.
4. Secrets live in git-ignored `.env` files. Only `.env.example` files are committed. Check
   `git diff --staged` before every commit.
5. Ask Greg before changing scope or architecture, or adding a paid service.
6. Tests before progress: never start a phase with failing tests.

## Toolchain (details and reasons in docs/DECISIONS.md D-001)

Foundry 1.8.1 (`network = "monad"`) · solc 0.8.30 · evm prague · OZ v5.7.0 · forge-std v1.9.7 ·
Node 22 · pnpm 10.28 · TypeScript 5.9.3 · viem 2.57.4 · vitest 5 · zod 4.

Cloud sessions: Foundry's installer fails behind the proxy (attestation download is blocked).
Install the release binaries directly:
`curl -sSL https://github.com/foundry-rs/foundry/releases/download/v1.8.1/foundry_v1.8.1_linux_amd64.tar.gz | tar -xz -C ~/.foundry/bin`
(create `~/.foundry/bin` first and add it to PATH).

## Commands

```bash
git submodule update --init --recursive   # forge-std + OpenZeppelin
pnpm install
pnpm contracts:test        # forge test
pnpm test                  # vitest in every TS package
pnpm typecheck
pnpm lint                  # prettier --check + forge fmt --check
pnpm format
pnpm contracts:rehearse:local   # anvil (Monad mode): DeployDemo + Smoke with a fill
pnpm contracts:rehearse:fork    # Monad mainnet fork: DeployLive + Smoke
pnpm --filter @floor/shared abi:sync   # after changing contracts (forge build first)
pnpm keeper:start               # keeper (keeper/.env; docs/keeper.md)
pnpm e2e:testnet                # testnet: mint → protect → crash → keeper fills
pnpm app:dev                    # app (app/.env.local; docs/app.md)
pnpm app:e2e                    # Playwright on anvil (production build)
```

Deploying for real: `docs/deploy.md`. Mainnet deploys need Greg's go-ahead.

## Layout

- `contracts/`: Foundry project (build prompt §6)
- `keeper/`: Node/TS keeper (§7)
- `app/`: Next.js 16 PWA (§8; docs/app.md). Next 16 differs from older versions: read `app/node_modules/next/dist/docs/` before changing framework-level code
- `packages/shared/`: chains, token registry, third-party addresses; later ABIs and trigger/minOut math
- `docs/`: addresses, architecture, decisions, perks, pitch outline

## House rules

- One phase at a time. Each phase ends with what was built, how to verify it, open questions
  and the next phase. Keep PROGRESS.md current.
- Use conventional commits (`feat(contracts): ...`).
- Explain Solidity, Foundry and Monad choices briefly in comments. Greg is strongest in
  TS/Next.js and PHP/Laravel.
- Monad gotchas: gas is charged on the gas **limit**. There's no global mempool. Keep the keeper
  EOA above 10 MON (reserve balance). Full nodes don't serve arbitrary historical state.
