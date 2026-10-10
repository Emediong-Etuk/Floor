# Architecture

```mermaid
flowchart TB
    subgraph Phone["Floor PWA (Next.js 16, phone first)"]
        UI["Home · Protect · Protection · Activity · Settings · /demo"]
        Privy["Privy embedded wallet<br/>(email login, no seed phrase)"]
        SW["Service worker<br/>(web push, installable)"]
    end

    subgraph Vercel["App server routes (Vercel free tier, keys stay server side)"]
        Sweep["On-demand keeper (D-011)<br/>/api/keeper/sweep · /api/demo/price<br/>same Keeper code as the process below"]
        Demo["/api/faucet · /api/demo/gap · /api/keeper/status"]
        Push["/api/push/subscribe (wallet-signed)<br/>/api/notify (Bearer secret)"]
        Store[("Upstash Redis<br/>push subscriptions")]
    end

    subgraph Keeper["Optional always-on keeper (pnpm keeper:start)"]
        Track["Track orders: events + 30 s resync"]
        Eval["Evaluate each block<br/>(same math as the contract, @floor/shared)"]
        Exec["Pre-check → quote → simulate → send<br/>(gas = estimate × 1.15)"]
    end

    subgraph Chain["Monad"]
        Floor["FloorOrders.sol<br/>orders · trigger check · minOut · OCO · fee"]
        Oracle["IFloorOracle<br/>PythAdapter (live) · MockOracle (demo)"]
        Venue["Allowlisted swap target<br/>0x AllowanceHolder (live) · MockRouter (demo)"]
        Tokens["User's tokens stay in the wallet<br/>(exact allowance to FloorOrders)"]
    end

    Pyth["Pyth: sponsored push feeds<br/>+ optional Hermes pull (D-004)"]
    ZeroX["0x Swap API (chain 143)"]

    UI -->|approve / createOrder / createBracket / update / cancel| Floor
    UI -->|read views, balances, prices| Floor
    UI -->|after a new protection| Sweep
    UI --> Demo
    UI --> Push
    Push --> Store
    Sweep -->|execute| Floor
    Sweep -->|sold / selling / waiting| Push
    Track --> Floor
    Eval --> Oracle
    Exec -->|quote| ZeroX
    Exec -->|execute id, priceUpdate, swap| Floor
    Exec -->|events| Push
    Floor -->|update + getPriceE18| Oracle
    Oracle --- Pyth
    Floor -->|transferFrom owner, amountIn| Tokens
    Floor -->|call with data| Venue
    Push -->|web push| SW
```

**Who runs the keeper.** On testnet, prices only move when `/demo` moves them, so the app's
server routes run one keeper sweep right after each price move and each new protection
(D-011): no paid host needed. For live prices, run the same `Keeper` class always-on with
`pnpm keeper:start` (`docs/keeper.md`); it posts its events to `/api/notify`.

## How a protection fills

1. The user approves the exact amount to `FloorOrders` and creates an order or a bracket. The
   tokens stay in the user's wallet.
2. The keeper sees `OrderCreated` and adds the order to its in-memory set. It re-reads
   `getActiveOrders` every 30 s as a safety net.
3. Each block (~400 ms), the keeper evaluates triggers with the same math as the contract.
4. When an order triggers, the keeper:
   - checks the owner's balance and allowance (Multicall3),
   - gets a 0x quote with `taker = FloorOrders` (live mode),
   - rejects the quote if it's below `minOut`,
   - simulates `execute`, then sends it with a tight gas limit (Monad charges the limit, not
     the gas used).
5. `execute` re-checks everything onchain:
   - oracle freshness and confidence,
   - the trigger,
   - the target and spender allowlist,
   - `received ≥ minOut`.

   It marks the order filled (and cancels the OCO sibling) **before** any external call.

6. USDC goes to the owner, minus the fees. The keeper's events become web pushes ("Floor hit:
   sold 1,000 WMON · You got 19.94 USDC"), sent straight from the on-demand sweep or via
   `/api/notify` from an always-on keeper.

## Trust model

- **Custody:** the user keeps their tokens. FloorOrders holds nothing between calls (a tested
  invariant).
- **Price:** the contract checks the trigger against the oracle. A keeper can't fire early.
- **Fill quality:** `minOut` comes from the oracle price and the user's `maxSlippageBps`. A
  malicious executor can make the user no worse off than that (D-003).
- **Liveness:** anyone can call `execute`. Our keeper is a convenience. If it goes down,
  protections stop firing until someone executes them. The README states this limitation.
- **Owner:** can pause (cancels still work), cap the fee at ≤ 0.5%, and change the token and
  venue allowlists, oracle limits and **the oracle itself**. A malicious owner with a fake
  oracle could trigger sales at bad prices, so users trust the owner key with the oracle and
  venue list. Before mainnet caps go up: a multisig owner and a timelock on `setOracle` and
  `setSwapTarget`.

## Deployment modes

|               | Demo (testnet 10143)                                               | Live (mainnet 143)                 |
| ------------- | ------------------------------------------------------------------ | ---------------------------------- |
| Oracle        | `MockOracle` (price set from `/demo`)                              | `PythAdapter` → Pyth `0x2880…7B43` |
| Venue         | `MockRouter` (oracle price minus spread, optional "liquidity gap") | 0x AllowanceHolder `0x0000…2734`   |
| Tokens        | `MockERC20` with a public capped mint                              | WMON, WETH, (cbBTC) → USDC         |
| Per-order cap | none                                                               | $500 (`maxOrderUsdE18`)            |

Addresses and sources: `docs/addresses.md`.
