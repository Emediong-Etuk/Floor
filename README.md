# Floor

**A safety net for crypto holders on Monad.** Set a price floor on a token you hold. If the
price falls to it, Floor sells to USDC automatically, even while you sleep. You can also set a
cash-out price to lock in profit, and whichever price is hit first wins.

> ⚠️ **Hackathon software. Not audited.** Built for the Monad Metropolis Hackathon (Onchain
> Finance & Trading). Use tiny amounts only.

## Status

- **Contracts:** done, with 75 Foundry tests (fuzz, invariants, shared vectors, mainnet-fork). Deployed and
  verified on Monad testnet (`docs/addresses.md`).
- **Keeper:** done. On Monad testnet it filled a protected order **474 ms after the price
  crashed** (`docs/keeper.md`).
- **App:** next. See [`PROGRESS.md`](PROGRESS.md) for live status.

## How it works

- **Your tokens stay in your wallet** until a protection fires. You approve the exact amount;
  nothing is pooled.
- **The contract checks the price itself** against the Pyth oracle and enforces a minimum
  output, so a keeper can't fire early or sell at a bad price.
- **Anyone can execute.** Our keeper is a convenience, not a trusted party. In the worst case a
  malicious executor can only sell at your oracle-derived minimum (your max price difference
  setting).

Architecture: [`docs/architecture.md`](docs/architecture.md). Addresses and sources:
[`docs/addresses.md`](docs/addresses.md). Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Security model (contracts)

- **Swap venues are allowlisted** as (target, spender) pairs. An executor can't make
  `FloorOrders` call a token or itself, so nobody can drain approvals by turning the contract
  against users.
- **Approvals are exact and short-lived.** For each fill, the venue gets approval for exactly
  `amountIn`, and it is reset to 0 in the same transaction.
- **Effects come before interactions,** and every state-changing entry point is
  `nonReentrant`. An order (and its bracket sibling) is closed before any external call.
- **Fills are judged by balance changes,** not by what the venue returns. The output must
  reach `minOut = oracle value × (1 − maxSlippageBps)`.
- **Worst case:** a malicious executor can at most fill your order at `minOut`, within your
  max price difference setting. Slippage is capped at 5% and the executor fee at 0.5%.
- **The contract holds nothing between calls.** This is checked by an invariant test.
- `Ownable2Step` and `Pausable`. Pausing blocks new orders and fills but never cancels. No
  upgradeability and no `delegatecall`.

## Repo layout

| Path               | What                                                   |
| ------------------ | ------------------------------------------------------ |
| `contracts/`       | Foundry project: `FloorOrders`, oracle adapters, mocks |
| `keeper/`          | Node/TypeScript keeper (viem)                          |
| `app/`             | Next.js PWA (Phase 4)                                  |
| `packages/shared/` | Chains, token registry, shared math and ABIs           |
| `docs/`            | Architecture, addresses, decisions, perks, pitch       |

## Run locally

Requirements: Node 22, pnpm 10.28, Foundry ≥ 1.8.0 (Monad support).

```bash
git clone --recurse-submodules https://github.com/Emediong-Etuk/floor
cd floor
pnpm install
pnpm contracts:test   # Solidity tests
pnpm test             # TypeScript tests
pnpm typecheck
pnpm lint
```

Each package has an `.env.example`. Copy it to `.env` (git-ignored) and fill it in.

## Limitations

- Not audited.
- Oracle risk: prices come from Pyth. WETH is priced with ETH/USD.
- Liquidity risk: in a very fast crash the sale happens at the market price at that moment,
  which can be slightly below your floor. If no venue can fill within your limit, the order
  waits.
- Keeper liveness: if no one executes, protections don't fire.

## License

[MIT](LICENSE)
