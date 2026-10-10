# Floor

**A safety net for crypto holders on Monad.** Set a price floor on a token you hold. If the
price falls to it, Floor sells to USDC automatically, even while you sleep. You can also set a
cash-out price to lock in profit, and whichever price is hit first wins.

> ⚠️ **Hackathon software. Not audited.** Built for the Monad Metropolis Hackathon (Onchain
> Finance & Trading). Use tiny amounts only.

## Status

Phase 0 (recon and scaffold) is done. See [`PROGRESS.md`](PROGRESS.md) for live status.

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
