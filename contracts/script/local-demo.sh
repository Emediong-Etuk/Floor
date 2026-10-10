#!/usr/bin/env bash
# Local rehearsal of the testnet deploy: anvil in Monad mode -> DeployDemo -> Smoke (create,
# cancel and a full fill). Writes deployments/31337.json (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"

anvil --network monad --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

# Anvil's first default account, derived from Foundry's public test mnemonic. It only holds
# funds on local chains and forks; never use it anywhere else.
export DEPLOYER_PRIVATE_KEY="$(cast wallet private-key "test test test test test test test test test test test junk" 0)"
# Keep rehearsal tx logs out of broadcast/, where real deploy logs live.
export FOUNDRY_BROADCAST=broadcast-rehearsal
export DEPLOYMENTS_FILE=deployments/31337.json

forge script script/DeployDemo.s.sol --rpc-url "$RPC" --broadcast --gas-estimate-multiplier 115
SMOKE_FILL=true forge script script/Smoke.s.sol --rpc-url "$RPC" --broadcast --gas-estimate-multiplier 115
echo "local demo deploy + smoke: OK"
