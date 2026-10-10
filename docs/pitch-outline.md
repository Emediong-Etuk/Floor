# Pitch outline

Problem → Solution → Demo → How it works → Why Monad → Business model → Go-to-market →
Roadmap → Team (build prompt §13). One slide per section; a 3–5 minute talk or a deck for the
submission. The positioning research from Phase 0 is at the end.

## 1. Problem

- **Tunde** holds $300 of MON. At 3am it drops 25%. He's asleep, and by morning a third of his
  savings is gone.
- Casual holders can't watch charts 24/7. Centralised exchanges have stop-losses, but onchain,
  self-custody holders have nothing that watches their wallet for them.
- The tools that exist are built for traders: order books, terminals, chart-drawn orders. A
  holder with $50–$500 on a phone won't use them.

## 2. Solution

**Floor: a safety net for your crypto.** Set a floor price on a token you hold. If the price
falls to it, Floor sells to USDC automatically. Optionally set a cash-out price to lock in
profit; whichever is hit first wins.

- Email login, no seed phrase (Privy embedded wallet).
- One slider, a plain-English summary ("If WMON drops to $0.0225, Floor will sell 2,000 WMON for
  about 44.96 USDC").
- Tokens never leave your wallet until a protection sells. You approve only the amount you
  protect.
- A push notification when it sells, with the receipt.

## 3. Demo

Live on Monad testnet: protect → crash the price 20% → the keeper sells **0.4 s after the floor
was hit** → push → receipt in Activity. Script: [`demo-script.md`](demo-script.md).

Screenshots: [`screenshots/`](screenshots/).

## 4. How it works

- `FloorOrders` (Solidity) stores protections: token, amount, trigger, max price difference,
  optional never-sell-below and expiry. A bracket links a floor and a cash-out (one cancels
  the other).
- **Anyone can execute.** When the oracle price crosses a trigger, an executor calls
  `execute`. The contract checks the trigger against the oracle itself, sells through an
  allowlisted venue (0x AllowanceHolder live, MockRouter in the demo), and requires the
  output to reach `minOut = oracle value × (1 − max price difference)`.
- **Our keeper** watches every block and executes first. It's a convenience, not a trusted
  party: a malicious executor can at most sell at your minimum.
- Safety: (target, spender) venue allowlist; exact, same-transaction approvals;
  checks-effects-interactions plus `nonReentrant`; the contract holds nothing between calls
  (an invariant test).
- Evidence: 75 Foundry tests (unit, fuzz, invariants, hostile venues, mainnet fork with real
  Pyth prices), 300 shared math vectors checked in Solidity and TypeScript, keeper unit and
  e2e tests, and Playwright e2e plus axe on the app. Diagram: [`architecture.md`](architecture.md).

## 5. Why Monad

- **400 ms blocks, ~800 ms finality:** the sale lands close to the floor, not several blocks
  later at a worse price. On testnet our keeper filled **474 ms after the crash confirmed**.
- **Cheap gas:** a fill costs about 300k gas, so a $20 protection is worth setting. On
  Ethereum mainnet the gas would eat it.
- **Deep aggregated liquidity:** 0x routes across Kuru, Clober, Crystal and the AMMs on Monad,
  so Floor gets the best of every venue without competing with any of them.
- **Pyth on Monad:** sponsored push feeds for the majors; Hermes pull updates when we want
  per-block freshness (D-004).

## 6. Business model

- **0.1% of the sale, only when a protection sells.** Free to set, free if it never triggers.
  Users pay for the outcome, not the promise.
- The fee is paid onchain to whoever executes the sale, which is our keeper in practice. So
  the keeper funds its own gas, and the model scales without a subscription. The contract
  caps the fee at 0.5%, so it can never be raised past that.
- Later: an open keeper network (anyone can earn the fee) and a fee share for wallets that
  embed Floor.

## 7. Go-to-market

- **Pilot with Greg's West African crypto community:** holders who keep savings in crypto,
  live on phones, and are exposed to sharp moves while they sleep. Email login and
  plain-English copy are built for them.
- Channels: community Telegram and X; a Telegram alerts bot is on the roadmap because that's
  where the community lives.
- Then: embed in Monad wallets and apps as a widget ("protect this token"), so Floor reaches
  holders where they already are.
- Metrics for the pilot: protections created, value protected, fills, median fill latency,
  and retention after the first fill.

## 8. Roadmap

1. **Mainnet launch** with a $500 per-order cap, via 0x (the contracts and deploy scripts are
   ready and fork-tested).
2. **Trailing floors:** the floor rises with the price ("lock in my gains").
3. **Sponsored gas** so users never need MON (smart wallet + paymaster).
4. **One-tap approve + protect** (EIP-7702 batching or Permit2).
5. **Telegram bot** and email alerts.
6. **Embeddable widget / SDK** for any Monad wallet.
7. An **open keeper network**, and a second venue (Kuru) for better quotes.
8. An audit before raising the per-order cap.

## 9. Team

- **Greg (Emediong Etuk Gregory):** founder. Builder (TypeScript / Next.js, PHP / Laravel),
  designer and illustrator, based in Nigeria and part of the West African crypto community
  the pilot targets.
- TODO(Greg): any teammates, links (X, GitHub), and one line on why you're building this.

## Honest limitations (say them before a judge asks)

- Not audited. Testnet demo; mainnet is ready but not launched.
- Oracle risk (Pyth) and liquidity risk: in a very fast crash the sale happens at the market
  price of that moment, which can be slightly below the floor, and never below your minimum.
- Keeper liveness: if nobody executes, protections don't fire. The hosted demo runs the keeper
  on demand (D-011); `pnpm keeper:start` runs it always-on.

## Appendix: positioning note (Phase 0 recon, 2026-10-10)

**What we checked:** Kuru's docs index, the Monad protocols registry, 0x's Monad docs, and
web searches for keeper-executed stop-loss or take-profit products on Monad.

**What we found:**

- **Kuru** is an onchain CLOB plus the Kuru Flow aggregator. It has a trading terminal ("Pro"),
  a simple swap mode ("Lite") and an embedded Privy wallet. Its docs describe limit orders and
  market making. We found **no documented spot stop-loss, take-profit or OCO order**. Some
  secondary coverage mentions chart-drawn limit orders for Pro users.
- **Clober** and **Crystal** are onchain CLOBs with limit orders. We found nothing documented
  about trigger-based orders.
- **Monorail** and **Mace** are aggregators. Swaps only.
- **0x** routes through all of those venues on Monad. Its blog explains stop orders in concept,
  but it doesn't run them for users.
- Outside Monad, the nearest design is DeepBook's TPSL on Sui (permissionless execute with
  keepers). That supports the architecture choice, but it isn't a competitor here.

**Gap to close manually:** the [Monad App Hub](https://app.monad.xyz/app-hub) is a JavaScript
app we couldn't read from here. Greg should spend five minutes filtering it for "Trading" and
"DEX", and check Kuru Pro's order ticket for a TP/SL toggle. If Kuru Pro has one, the
positioning below still holds: it's a terminal for traders, and Floor is a safety net for
holders.

**Positioning:**

> Kuru, Clober and Crystal give _traders_ order books. Floor gives _holders_ a safety net. It
> takes one slider, works with email login, uses plain English, and never takes custody. It
> sells through 0x, so it fills against all of those venues at once.

What sets Floor apart:

1. Built for a person, not for traders: casual holders on a phone, starting with a West African
   community pilot.
2. The trust model fits in one sentence: "the contract checks the price itself, so anyone can
   execute and nobody can cheat."
3. It's venue-agnostic: Floor sells through the aggregator and doesn't compete with the DEXes.
4. It's embeddable: on the roadmap as a widget other Monad wallets can add (Embedded Trading).
