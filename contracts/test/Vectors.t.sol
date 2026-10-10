// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FloorMath} from "../src/libraries/FloorMath.sol";

/// @notice FloorMath against the shared vectors in packages/shared/test/vectors/min-out.json.
/// The keeper's TypeScript mirror is checked against the same file, so the two can't drift.
contract VectorsTest is Test {
    function test_minOut_matchesSharedVectors() public view {
        string memory json = vm.readFile("../packages/shared/test/vectors/min-out.json");
        string[] memory a = vm.parseJsonStringArray(json, ".amountIn");
        string[] memory dIn = vm.parseJsonStringArray(json, ".decIn");
        string[] memory dOut = vm.parseJsonStringArray(json, ".decOut");
        string[] memory pIn = vm.parseJsonStringArray(json, ".priceIn");
        string[] memory pOut = vm.parseJsonStringArray(json, ".priceOut");
        string[] memory s = vm.parseJsonStringArray(json, ".slippageBps");
        string[] memory want = vm.parseJsonStringArray(json, ".minOut");
        assertGt(a.length, 100);
        for (uint256 i; i < a.length; ++i) {
            uint256 got = FloorMath.minOut(
                vm.parseUint(a[i]),
                uint8(vm.parseUint(dIn[i])),
                uint8(vm.parseUint(dOut[i])),
                vm.parseUint(pIn[i]),
                vm.parseUint(pOut[i]),
                vm.parseUint(s[i])
            );
            assertEq(got, vm.parseUint(want[i]), string.concat("vector ", vm.toString(i)));
        }
    }
}
