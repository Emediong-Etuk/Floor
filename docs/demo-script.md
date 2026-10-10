# Demo script (3 minutes)

This follows build prompt §13, adapted to what exists today: a testnet demo with an
on-demand keeper (D-011) and mainnet evidence from fork tests. Times are targets. Speak
slowly; the app is fast enough that you'll have spare seconds.

**Before you record:** run the [recording checklist](#recording-checklist) below.

## Script

### 0:00–0:20 · Problem

> "This is Tunde. He holds $300 of MON. At 3am it drops 25%, and he's asleep. Exchanges have
> stop-losses, but onchain, nobody watches your wallet for you. You can't watch charts 24/7."

On screen: the welcome screen on a phone ("A safety net for your crypto.").

### 0:20–0:40 · Login

> "Floor is a safety net. I sign in with my email: no seed phrase, no extension."

- Tap **Continue with email**, enter the email and the code. Privy creates an embedded wallet.
- Home shows your tokens. If it's a fresh account, open **Demo** → **Mint test tokens** first
  (do this before recording, so Home already has WMON).

### 0:40–1:20 · Protect

> "I want to protect my MON. I tap Protect."

- Tap **Protect** next to WMON.
- Tap **50%** for the amount.
- Drag the floor slider to **−10%**. Read the trigger price out loud.
- Toggle **Also cash out if it goes up** and leave it at **+20%**.
- Point at the plain-English summary:
  > "It says exactly what will happen: if WMON falls to this price, sell for USDC. If it rises
  > to this one, cash out. Whichever comes first. The fee is 0.1%, only if it sells."
- Tap **Approve exact amount**, then **Turn on protection**.
  > "I only approve the amount I'm protecting. My tokens stay in my wallet."
- Tap **Done**. Home shows the card with its distance-to-floor bar and a **Protected** chip.

### 1:20–1:50 · The crash

> "Now let's crash the market."

- Open **Demo**. Under **3. Move the price**, tap **−20%**.
- The panel shows the price move, then: **"Keeper sold protection #1 0.4 s after the floor
  was hit"**. Tap **view** to open the fill on MonadVision.
  > "The keeper sold in under a second, onchain, on Monad testnet."
- If push is set up, the phone shows **"Floor hit: sold 1,000 WMON · You got 19.94 USDC…"**.
  Hold the phone up for it.
- Open **Activity**: the receipt shows the amount sold, the USDC received, the fee and the tx.

### 1:50–2:20 · Trust

> "Why should anyone trust a bot with this? You don't have to. The contract checks the oracle
> price itself, and it enforces a minimum output based on that price. So anyone can execute,
> and nobody can cheat: not a keeper, not us."

- Back on **Demo**, turn on **Liquidity gap** ("the market now pays 3% under the oracle"),
  protect a little more WMON, and crash again. The keeper reports it is waiting for liquidity
  instead of selling cheap. Turn the gap off and it sells.
  > "If the market can't pay a fair price, Floor waits instead of dumping your tokens."
- Mainnet evidence, pick whichever exists on the day:
  - **With a mainnet deploy:** show the real fill through 0x on MonadVision.
  - **Without one:** show the mainnet-fork test (`forge test --match-contract Deploy -vv` with
    `MONAD_MAINNET_RPC_URL`), which deploys against real Pyth prices, and the 75 passing
    contract tests. Say plainly: "Live mainnet launch is next; tonight this is testnet."

### 2:20–2:40 · Why Monad

> "On most chains, a stop-loss fills blocks after the crash, at a worse price, and the gas
> eats a small position. Monad has 400 ms blocks and cheap gas. Our keeper filled 474 ms after
> the crash confirmed on testnet. That makes a $20 protection worth having."

### 2:40–3:00 · Next

> "Next: trailing floors that rise with the price, a Telegram bot, sponsored gas so users
> never need MON, and Floor as a widget any Monad wallet can embed. We're starting with a
> pilot in my West African crypto community. Floor: set it, and sleep."

End on the Home screen with the protection card.

## Recording checklist

### Accounts and config (the day before)

- [ ] Vercel deploy is live in demo mode (`docs/app.md` → Deploy to Vercel).
- [ ] Privy: email login works on the Vercel domain (allowed origins set).
- [ ] Push: VAPID keys and Upstash set; alerts turned on and a test push received on the phone
      you'll record with. On iPhone, the app is installed to the Home Screen first.
- [ ] The deployer (demo operator) has at least 2 testnet MON for faucet drips and price moves.
- [ ] The keeper key (or the operator key) has at least 1 testnet MON.
- [ ] `/demo` → Keeper card shows the keeper address and balance (not "not configured").

### Right before recording

- [ ] Sign in on the recording phone with a fresh email (or one with no open protections).
- [ ] **Demo → Mint test tokens** so Home shows 10,000 WMON.
- [ ] **Demo → Reset to the starting price** for WMON (from a previous take).
- [ ] **Liquidity gap is off.**
- [ ] Do one full dry run: protect → −20% → sold. Then reset the price.
- [ ] Phone: Do Not Disturb **off** for the browser/PWA (so the push shows), other notifications
      silenced, battery icon reasonable, brightness up, dark mode on.
- [ ] Explorer tabs pre-loaded: the FloorOrders contract and the 474 ms fill tx
      (`docs/keeper.md`).
- [ ] If showing the fork test: terminal open in `contracts/` with large font, command typed.

### Capture

- [ ] Record the phone screen (iOS Screen Recording or Android's recorder) in portrait at 1080p
      or better. Optionally composite it next to a laptop for the explorer and terminal bits.
- [ ] Record the voice separately or in a quiet room. Keep the total **under 3:00**.
- [ ] Captions on the key numbers: "0.4 s after the floor was hit", "0.1% fee only when it
      sells", "474 ms on Monad testnet".

### After

- [ ] Upload (YouTube unlisted or Loom) and put the link in the README and the submission.
- [ ] Reset the demo price so judges start from the normal price.
