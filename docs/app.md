# App

A Next.js 16 PWA in `app/`, built for phones first (360–430 px). It uses React 19, Tailwind 4,
Privy email login with an embedded wallet, TanStack Query and viem.

## Screens

| Route               | What                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | Logged out: welcome, with "Continue with email" (Privy; no seed phrase). Logged in: the total protected, a gas banner (one-tap test MON in demo mode), your tokens with **Protect** buttons, and your active protections with a distance-to-floor bar and a status chip.                                                  |
| `/protect/[symbol]` | Amount with 25/50/75/MAX, a floor slider (−1 to −50%, default −10%), "also cash out if it goes up" (+5 to +300%, default +20%), and an advanced section (max price difference 0.3–5%, never sell below, expiry). Then a plain-English summary, the fee line, and the steps **Approve exact amount → Turn on protection**. |
| `/protection/[id]`  | Both legs, the current price, edit floor / cash-out (`updateOrder`), cancel (`cancelOrder`), and the fill tx.                                                                                                                                                                                                             |
| `/activity`         | Sales, with a receipt ("Sold 1,000 WMON at $0.0200 → 19.94 USDC · fee · View tx"), plus cancels and expiries.                                                                                                                                                                                                             |
| `/settings`         | Account, wallet, network, contract link, how Floor keeps you safe, log out.                                                                                                                                                                                                                                               |
| `/demo`             | Testnet only: mint test tokens, move the mock price (−5%, −20%, +20%, custom, reset), toggle the liquidity gap, keeper status.                                                                                                                                                                                            |

Every number on screen comes from the chain: oracle prices, balances, orders and fills. The
app never fakes a transaction. Each write is simulated first, so contract errors show up as
plain English (`src/lib/errors.ts`).

## On-demand keeper (D-011)

On testnet, prices only move when the `/demo` panel moves them. So `/api/demo/price` sets the
price and then runs **one keeper sweep** with the same `Keeper` code as the always-on process
(`@floor/keeper/sweep`). After a user creates a protection, the app calls
`/api/keeper/sweep`, so a floor that's already crossed sells right away.

This needs no paid hosting: everything runs in Vercel's free tier. To run an always-on keeper
as well, use `pnpm keeper:start` (see `docs/keeper.md`).

## API routes (server-only keys)

| Route                                                            | Does                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/faucet` `{address}`                                   | Sends 0.2 test MON (only if the wallet holds under 0.05) and mints 10,000 WMON + 0.5 WETH.    |
| `POST /api/demo/price` `{symbol, bps}` or `{symbol, reset:true}` | Moves the MockOracle price, then runs a keeper sweep. Returns the tx and what the keeper did. |
| `POST/GET /api/demo/gap`                                         | Opens or closes MockRouter's liquidity gap (closing runs a sweep).                            |
| `POST /api/keeper/sweep`                                         | Runs one keeper pass.                                                                         |
| `GET /api/keeper/status`                                         | Keeper address and balance, active orders, last sweep.                                        |

## Deploy to Vercel (free tier)

1. **Privy:** create an app at dashboard.privy.io and enable **email** login. Copy the App ID.
   Under allowed domains / origins, add your Vercel URL (and `http://localhost:3000` for
   local dev).
2. **Vercel:** "Add New Project", then import `Emediong-Etuk/floor`.
   - **Root Directory:** `app`. Vercel detects the pnpm workspace and Next.js.
   - **Environment variables:**

     | Name                        | Value                                                                                             |
     | --------------------------- | ------------------------------------------------------------------------------------------------- |
     | `NEXT_PUBLIC_PRIVY_APP_ID`  | your Privy App ID                                                                                 |
     | `NEXT_PUBLIC_CHAIN_ID`      | `10143`                                                                                           |
     | `NEXT_PUBLIC_DEMO_MODE`     | `true`                                                                                            |
     | `NEXT_PUBLIC_RPC_URL`       | `https://testnet-rpc.monad.xyz` (or the QuickNode URL)                                            |
     | `DEMO_OPERATOR_PRIVATE_KEY` | the **deployer** key (it owns MockOracle/MockRouter and mints test tokens). With or without `0x`. |
     | `KEEPER_PRIVATE_KEY`        | the keeper key (optional: falls back to the operator key)                                         |

3. Deploy, open the URL on your phone, and use "Add to Home Screen".

Top up the deployer with testnet MON now and then. Each new judge gets 0.2 MON for fees from
the faucet route.

## Run locally

```bash
cp app/.env.example app/.env.local   # fill in the values above
pnpm app:dev                         # http://localhost:3000
```

## Tests

`pnpm app:e2e` runs Playwright at a Pixel 7 viewport against a production build, wired to a
local anvil chain (Monad mode, 400 ms blocks) with a fresh DeployDemo. It covers:

1. sign in → mint test tokens → protect 1,000 WMON with a floor and a cash-out → the price
   drops 20% → the keeper sells → Home empties and Activity shows "19.94 USDC" with the tx
   link;
2. edit a floor, then cancel;
3. readable validation when protecting more than you hold.

On anvil only, the e2e run uses a local test-key wallet in place of Privy (guarded to chain
31337). Production always uses Privy.
