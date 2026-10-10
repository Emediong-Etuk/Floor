# Submission checklist

Build prompt §13, with the state as of 2026-10-10. ✅ done · ⏳ needs Greg · ➖ optional.

**Deadline: Tue 2026-10-13, 7:59 AM WAT** (Mon 11:59 PM PT, 06:59 UTC). Plan to submit by
**Mon 2026-10-12, 10:00 PM WAT**, with a code and docs freeze at **6:00 PM WAT**, so nothing
depends on being awake at 7 AM.

| When (WAT)        | What                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| Sun 11 Oct, noon  | Decide on mainnet (go / no-go). Send the team line.                       |
| Sun 11 Oct, night | If go: mainnet deploy + one tiny real fill. Dry-run the demo script.      |
| Mon 12 Oct, 2 PM  | Demo video recorded and uploaded.                                         |
| Mon 12 Oct, 6 PM  | Freeze: video link and final numbers in README; last PR merged; CI green. |
| Mon 12 Oct, 10 PM | Submit. Reset the demo price; top up the deployer for judges.             |

## Required

| Item                                                                                                     | State | Notes                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live PWA URL (Vercel) in demo mode                                                                       | ✅    | https://floor-delta-ruby.vercel.app (Privy email login verified on the live domain; server keeper configured).                                                        |
| Mainnet mode behind a toggle or separate URL                                                             | ⏳ ➖ | Needs the mainnet deploy. A second Vercel project with `NEXT_PUBLIC_CHAIN_ID=143`, `NEXT_PUBLIC_DEMO_MODE=false`, plus an always-on keeper.                           |
| Verified testnet contract addresses                                                                      | ✅    | `docs/addresses.md` (7 contracts, verified on MonadVision).                                                                                                           |
| Verified mainnet addresses and at least one mainnet fill tx                                              | ⏳    | Needs Greg's go-ahead and about 1.5 MON (`docs/deploy.md`), a 0x API key and a funded keeper. Until then: the mainnet-fork rehearsal and fork tests are the evidence. |
| README: problem, solution, screenshots, architecture, trust model, run, env, tests, limitations, roadmap | ✅    | `README.md`. Add the live URL and the video link once they exist.                                                                                                     |
| Demo video (≤ 3 min)                                                                                     | ⏳    | Script and recording checklist: `docs/demo-script.txt`. Record after the Vercel deploy.                                                                               |
| Pitch outline                                                                                            | ✅    | `docs/pitch-outline.md`. Team section needs Greg's line and links.                                                                                                    |

## Phase 6 polish

| Item                            | State | Notes                                                                                                                                     |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Empty, loading and error states | ✅    | Skeletons while loading; empty states on Home and Activity; a "can't reach Monad" note when reads fail; contract errors in plain English. |
| Accessibility                   | ✅    | axe (WCAG 2.1 A/AA) passes on every screen in Playwright; `<main>` landmark; labelled controls.                                           |
| Lighthouse (mobile)             | ✅    | 91 / 100 / 100 / 100 (performance, accessibility, best practices, SEO) on a local production build.                                       |
| Installable PWA                 | ✅    | Manifest, PNG icons, service worker (tested in Playwright).                                                                               |
| Push on a real phone            | ✅    | Verified by Greg on 2026-10-10 on the live app: alerts turned on, a demo crash sold, and the push arrived.                                |

## Before you submit (Greg)

1. ~~Create the Privy app (email login) and add the Vercel domain to allowed origins.~~ Done.
2. ~~Deploy to Vercel with the env vars in `docs/app.md`; add VAPID keys and Upstash Redis.~~
   Done.
3. ~~On your phone: install, sign in, turn on alerts, protect → crash → sold, push arrives.~~
   Done.
4. Optional: mainnet deploy and one tiny real fill through 0x (`docs/deploy.md`,
   `docs/keeper.md`).
5. Record the demo with `docs/demo-script.txt`; upload it.
6. Put the video link at the top of `README.md` (the live URL is already there).
7. Fill in the Team section of `docs/pitch-outline.md`.
8. Submit: repo URL, live URL, video, contract addresses (testnet, plus mainnet if deployed),
   and the 474 ms testnet fill tx.
9. After submitting: reset the demo price on `/demo` and keep the deployer topped up with
   testnet MON for judges.
