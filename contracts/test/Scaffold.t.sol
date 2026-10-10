// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// Phase 0 smoke test: proves the toolchain, remappings and CI wiring work.
/// Replaced by the real FloorOrders suites in Phase 1.
contract ScaffoldTest is Test {
    function test_toolchainAndRemappings() public pure {
        // OZ mulDiv is what FloorOrders will use for minOut math (no overflow on a*b).
        assertEq(Math.mulDiv(type(uint256).max, 2, 4), type(uint256).max / 2);
    }
}
