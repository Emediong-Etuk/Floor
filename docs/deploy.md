# Deploy runbook

Scripts live in `contracts/script/`. Each deploy writes `contracts/deployments/<chainId>.json`,
which the keeper and app read. Commit `10143.json` and `143.json` after real deploys.

| Script             | What it does                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DeployDemo.s.sol` | Testnet (10143) or local anvil (31337). Deploys MockOracle with seeded prices, faucet tokens (WMON, WETH, cbBTC, USDC), a funded MockRouter and FloorOrders, all wired together. Optionally sets the `/demo` panel's operator.                          |
| `DeployLive.s.sol` | Mainnet (143) only. Deploys PythAdapter on the real Pyth contract with 4 feeds, and FloorOrders with WMON, WETH and cbBTC → USDC allowlisted. 0x AllowanceHolder is the only venue. $500 per-order cap, and a 3,900 s max oracle age per token (D-004). |
| `Smoke.s.sol`      | Post-deploy check against the deployments JSON: wrap or mint WMON, create a bracket, cancel it, check both legs closed. Demo only, with `SMOKE_FILL=true`: also protect, crash the price, execute and check the fill.                                   |
| `local-demo.sh`    | Rehearsal: anvil in Monad mode → DeployDemo → Smoke with a fill.                                                                                                                                                                                        |
| `fork-live.sh`     | Rehearsal on a local **fork of Monad mainnet** → DeployLive → Smoke. Uses real Pyth, tokens and AllowanceHolder, and no real funds.                                                                                                                     |

Both rehearsals write to git-ignored places (`deployments/31337.json` or `fork-143.json`, and
`broadcast-rehearsal/`). A rehearsal can never be mistaken for a real deploy.

## Rehearse first (no keys, no funds)

```bash
pnpm contracts:rehearse:local   # demo stack on anvil, including a full fill
pnpm contracts:rehearse:fork    # live stack on a mainnet fork (uses https://rpc.monad.xyz)
```

Last run 2026-10-10: both passed. On the fork, all four Pyth feeds read fresh (21 s old,
confidence < 0.1%), and the bracket create/cancel worked against real WMON.

## Testnet (demo mode)

1. Make a **fresh** deployer key and fund it with about 3 MON from https://faucet.monad.xyz.
   - DeployDemo is 20 txs and about 10.4M gas, roughly 1.1 MON at 102 gwei.
   - Smoke with a fill is about 1M gas.
2. `cp contracts/.env.example contracts/.env` and set `DEPLOYER_PRIVATE_KEY`, plus
   `DEMO_OPERATOR_ADDRESS` if the `/demo` panel's server key exists already. Otherwise the
   owner can call `setOperator` later on MockOracle and MockRouter.
3. `pnpm contracts:deploy:demo`. This deploys and verifies on MonadVision (Sourcify, no API
   key).
4. `pnpm contracts:smoke:testnet`. This runs create → cancel, then a full fill.
5. Record the addresses in `docs/addresses.md` (Floor deployments) with explorer links, then
   commit `contracts/deployments/10143.json`.

## Mainnet (live mode). Greg confirms before this runs.

1. Run `pnpm contracts:rehearse:fork` again on the day. The feeds and the AllowanceHolder
   check run against current mainnet state.
2. Make a fresh deployer key with about 1.5 MON. DeployLive is 16 txs and about 6M gas,
   roughly 0.6 MON at 102 gwei. Smoke wraps 0.1 MON and gives it back.
3. Set `DEPLOYER_PRIVATE_KEY` and `MONAD_MAINNET_RPC_URL` (preferably a dedicated RPC).
4. `pnpm contracts:deploy:live`, then `pnpm contracts:smoke:mainnet`.
5. Record the addresses and commit `contracts/deployments/143.json`.
6. Later, when there's a Hermes key: the owner calls `setTokenMaxOracleAge(token, 0)` for each
   token to go back to the 15 s default.

## Verification

`--verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/` is in
the deploy commands (source: [Monad verify guide](https://docs.monad.xyz/guides/verify-smart-contract/foundry)).
If it fails mid-deploy, verify each contract by hand:

```bash
cd contracts
forge verify-contract <address> src/FloorOrders.sol:FloorOrders --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Monadscan verification needs an Etherscan-style API key (`--verifier etherscan
--etherscan-api-key ...`).

## Notes

- `--gas-estimate-multiplier 115`: Monad charges the gas **limit**, so we pad estimates by 15%
  (Foundry's default is 30%).
- The deployer owns everything (`Ownable2Step`). To hand over, call `transferOwnership(new)`
  and then `acceptOwnership()` from the new owner, on FloorOrders, PythAdapter, MockOracle and
  MockRouter.
- `forge test` runs the deploy scripts in-process (`test/Deploy.t.sol`). The mainnet-fork tests
  there run only when `MONAD_MAINNET_RPC_URL` is set:
  `MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz forge test --match-contract DeployLiveForkTest`.
