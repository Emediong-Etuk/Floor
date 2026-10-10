# Keeper

The keeper watches every active order and calls `FloorOrders.execute` when one triggers.
**Anyone can run it.** The contract checks the trigger and the minimum output itself, so the
keeper is a convenience, not a trusted party. It earns the executor fee (0.1%).

Code: `keeper/src`. Shared math and ABIs: `packages/shared`.

## How it works

| Step         | What happens                                                                                                                                                                                                                                                                                                                                                                                                          | File                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Track orders | Loads all orders with `getActiveOrders` at start. Order events (`OrderCreated`, `OrderUpdated`, `OrderCancelled`, `OrderFilled`, `OrderExpired`) keep the set current. A full reload every 30 s is a safety net. Nothing depends on historical state.                                                                                                                                                                 | `keeper.ts`, `index.ts`               |
| Prices       | Every block (~400 ms), reads `getPriceE18` for the tokens in use, with one Multicall3 call. That's MockOracle in demo mode, or PythAdapter's sponsored-push cache in live mode. With a Hermes key, fresher Hermes prices are overlaid (D-004).                                                                                                                                                                        | `chain.ts`, `venues.ts`               |
| Evaluate     | The contract's own rules, mirrored exactly: trigger, expiry, freshness, confidence and `minOut`. The math is checked against 300 shared test cases that the Solidity tests check too.                                                                                                                                                                                                                                 | `evaluate.ts`, `@floor/shared` math   |
| Fill         | For each triggered order: (a) check balance and allowance; (b) build the swap: MockRouter in demo, a 0x AllowanceHolder quote in live; (c) if the quote is below `minOut`, wait and notify once; (d) Hermes update bytes and their fee, if configured; (e) simulate; (f) send with gas = estimate × 1.15; (g) wait for the receipt, then notify.                                                                      | `keeper.ts`                           |
| Safety       | At most one fill in flight per order. A sent transaction is never re-sent until its receipt has been checked; with no receipt after 2 min it's treated as dropped. Nonces come from viem's local nonce manager. Reverts are decoded by name: `NotActive` means someone else filled it, `InsufficientOutput` means wait for liquidity, `InsufficientBalanceOrAllowance` means unfillable (notify once, retry in 30 s). | `keeper.ts`, `errors.ts`              |
| Expire       | Calls `expire(id)` on expired orders, at most 3 per block and only when no fill is in flight.                                                                                                                                                                                                                                                                                                                         | `keeper.ts`                           |
| Notify       | POSTs `selling`, `filled` (with latency), `waiting-liquidity` and `unfillable` to `NOTIFY_URL`, with `Authorization: Bearer NOTIFY_SECRET`.                                                                                                                                                                                                                                                                           | `notifier.ts`                         |
| Observe      | `GET /health`: status, chain, last block and its age, active / in-flight / pending counts, last fill latency, keeper balance, low-balance flag. `GET /metrics`: fills, expiries, failures and skips by reason, average latency, average gas (MON and USD). Logs are structured JSON (pino).                                                                                                                           | `index.ts`, `server.ts`, `metrics.ts` |

## Measured

- **Local anvil** (Monad mode, 400 ms blocks), `test/e2e.anvil.test.ts`: filled 312–418 ms
  after the price-crash transaction confirmed, about one block. The test also covers the
  liquidity-gap wait (no bad fill, then a fill once liquidity returns), notifications and
  `/health`.
- **Monad testnet**, `pnpm e2e:testnet` on 2026-10-10: filled **474 ms after the crash
  confirmed**. The keeper measured 804 ms from first seeing the trigger to the receipt.
  - Crash in block 69814849, fill in block 69814852
    ([tx](https://testnet.monadvision.com/tx/0xb9dc49f709ad033b40f45e05768f68bbdc3f2308c35b5bd26664ad96ceda7fab)).
  - The owner received 19.94 USDC, and the OCO sibling was cancelled.

## Run it

```bash
cp keeper/.env.example keeper/.env   # set KEEPER_PRIVATE_KEY (and RPC URLs)
pnpm keeper:start                    # or: pnpm keeper:dev (restarts on file changes)
curl localhost:8787/health
```

- **Keeper key:** use a dedicated EOA holding **more than 10 MON**. Monad caps the gas an
  account can have in flight at `min(10 MON, balance)`, so a low balance limits how many fills
  can be pending at once. `/health` reports `degraded` below 12 MON (`LOW_BALANCE_MON`).
- **RPC:** a dedicated provider (the QuickNode perk) for both HTTP and WSS. The public
  endpoints are rate-limited: about 25 rps for `eth_call` on testnet. The keeper makes about
  3 calls per block over HTTP polling, so the public endpoint works for a demo but not for
  production.
- **Host:** always-on (Railway, Render, Fly.io or a small VPS), not serverless. Start command
  `pnpm keeper:start`, health check `/health`.
- **Live mode** also needs `ZEROX_API_KEY`. `HERMES_URL` and `HERMES_API_KEY` are optional.

## Test it

```bash
pnpm --filter @floor/keeper test     # unit tests, plus the anvil e2e when Foundry is installed
pnpm e2e:testnet                     # real testnet: mint → protect → crash → fill → restore
```

`pnpm e2e:testnet` runs the keeper in-process against `contracts/deployments/10143.json`.
`KEEPER_PRIVATE_KEY` is required. The "user" key (`E2E_USER_PRIVATE_KEY`) defaults to the
keeper key. The price operator (`E2E_OPERATOR_PRIVATE_KEY`) defaults to
`DEPLOYER_PRIVATE_KEY`, the MockOracle owner.

## Not built yet

- Hermes SSE streaming. The keeper polls the REST endpoint instead, with a 1 s cache. Only
  relevant once there's a Hermes key.
- RPC failover across several providers (the Dwellir and Spectrum perks).
