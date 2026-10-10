# Pitch outline

This is a working draft. The full version is written in Phase 6 and follows build prompt §13.

## Positioning note (Phase 0 recon, 2026-10-10)

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

## Outline (fill in during Phase 6)

1. **Problem:** Tunde holds $300 of MON, it drops 25% at 3am, and he can't watch charts 24/7.
2. **Solution:** set a floor and a cash-out price, and Floor sells automatically.
3. **Demo:** see `docs/demo-script.md` (Phase 6).
4. **How it works:** see `docs/architecture.md`.
5. **Why Monad:** ~400 ms blocks and ~800 ms finality mean the fill lands near the floor, and
   cheap gas makes a $20 protection worth it. (The "Pyth every 400 ms" line holds only if we
   use Hermes. See D-004.)
6. **Business model:** a 0.1% fee only when a protection sells. Free if it never triggers.
7. **Go-to-market:** a pilot with Greg's West African crypto community.
8. **Roadmap:** trailing floors, a Telegram bot, gas sponsorship, the embeddable widget.
9. **Team:** to be filled in.
