// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

/// @notice Shared env helpers for the deploy scripts. Deployment JSON files live at
/// `deployments/<chainId>.json` unless `DEPLOYMENTS_FILE` overrides it (e.g. a mainnet fork
/// rehearsal that must not overwrite the real 143.json). The keeper and app read these files.
library DeploymentIO {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function path() internal view returns (string memory) {
        return vm.envOr(
            "DEPLOYMENTS_FILE", string.concat("deployments/", vm.toString(block.chainid), ".json")
        );
    }

    /// @notice Reads a private key from env, with or without the `0x` prefix (wallets export
    /// both forms; `vm.envUint` alone would misread a bare hex key as decimal).
    function privateKey(string memory name) internal view returns (uint256) {
        string memory raw = vm.envString(name);
        bytes memory b = bytes(raw);
        bool prefixed = b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X");
        return vm.parseUint(prefixed ? raw : string.concat("0x", raw));
    }

    /// @notice Like `privateKey`, but returns 0 when the variable is unset or empty.
    function privateKeyOr(string memory name) internal view returns (uint256) {
        if (bytes(vm.envOr(name, string(""))).length == 0) return 0;
        return privateKey(name);
    }
}
