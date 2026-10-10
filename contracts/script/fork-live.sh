#!/usr/bin/env bash
# Rehearse the mainnet deploy on a local fork of Monad mainnet: real Pyth, real tokens, real
# 0x AllowanceHolder, no real funds. DeployLive -> Smoke (wrap MON, create, cancel, unwrap).
# Writes deployments/fork-143.json (git-ignored) so the real 143.json is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8546}"
RPC="http://127.0.0.1:${PORT}"
FORK_URL="${MONAD_MAINNET_RPC_URL:-https://rpc.monad.xyz}"

anvil --network monad --fork-url "$FORK_URL" --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.3; done

# Anvil's first default account, derived from Foundry's public test mnemonic. It only holds
# funds on local chains and forks; never use it anywhere else.
export DEPLOYER_PRIVATE_KEY="$(cast wallet private-key "test test test test test test test test test test test junk" 0)"
# Keep rehearsal tx logs out of broadcast/, where real deploy logs live.
export FOUNDRY_BROADCAST=broadcast-rehearsal
export DEPLOYMENTS_FILE=deployments/fork-143.json

forge script script/DeployLive.s.sol --rpc-url "$RPC" --broadcast --gas-estimate-multiplier 115
forge script script/Smoke.s.sol --rpc-url "$RPC" --broadcast --gas-estimate-multiplier 115
echo "mainnet-fork live deploy + smoke: OK"
