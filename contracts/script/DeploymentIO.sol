// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

/// @notice Where deployment JSON files live. `DEPLOYMENTS_FILE` overrides the default
/// `deployments/<chainId>.json`, e.g. for a mainnet fork rehearsal that must not overwrite
/// the real 143.json. The keeper and app read these files.
library DeploymentIO {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function path() internal view returns (string memory) {
        return vm.envOr(
            "DEPLOYMENTS_FILE", string.concat("deployments/", vm.toString(block.chainid), ".json")
        );
    }
}
