// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FloorOrders} from "../src/FloorOrders.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {DeploymentIO} from "./DeploymentIO.sol";

interface IWMON {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @title Smoke
/// @notice Post-deploy check against a deployments JSON: create a bracket on WMON and cancel
/// it (the Phase 2 "create -> cancel" gate). In demo mode with SMOKE_FILL=true it also runs a
/// full fill: protect, crash the MockOracle price, execute through MockRouter, restore the price.
///
/// Env: SMOKE_PRIVATE_KEY (defaults to DEPLOYER_PRIVATE_KEY) · DEPLOYMENTS_FILE ·
/// SMOKE_MON_WEI (live only: MON to wrap, default 0.1 MON) · SMOKE_FILL (demo only; the key
/// must be the MockOracle owner or operator).
contract Smoke is Script {
    error SmokeFailed(string what);

    struct Ctx {
        address user;
        FloorOrders floor;
        address wmon;
        address usdc;
        address swapTarget;
        bool demo;
        uint256 amount;
    }

    function run() external {
        uint256 pk = vm.envOr("SMOKE_PRIVATE_KEY", uint256(0));
        if (pk == 0) pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Ctx memory c = _load(vm.addr(pk));

        vm.startBroadcast(pk);
        _fundWmon(c);
        IERC20(c.wmon).approve(address(c.floor), c.amount);
        _createAndCancel(c);
        if (c.demo && vm.envOr("SMOKE_FILL", false)) {
            _fill(c);
        } else {
            IERC20(c.wmon).approve(address(c.floor), 0);
            if (!c.demo) IWMON(c.wmon).withdraw(c.amount); // give the MON back
        }
        vm.stopBroadcast();
        console2.log("smoke OK on chain", block.chainid);
    }

    function _load(address user) internal view returns (Ctx memory c) {
        string memory file = DeploymentIO.path();
        string memory json = vm.readFile(file);
        c.user = user;
        c.floor = FloorOrders(vm.parseJsonAddress(json, ".floorOrders"));
        c.wmon = vm.parseJsonAddress(json, ".tokens.WMON");
        c.usdc = vm.parseJsonAddress(json, ".tokens.USDC");
        c.swapTarget = vm.parseJsonAddress(json, ".swapTarget");
        c.demo = keccak256(bytes(vm.parseJsonString(json, ".mode"))) == keccak256("demo");
        c.amount = c.demo ? 1_000e18 : vm.envOr("SMOKE_MON_WEI", uint256(0.1 ether));
        console2.log("deployment:", file);
        console2.log("user:      ", user);
    }

    function _fundWmon(Ctx memory c) internal {
        if (c.demo) MockERC20(c.wmon).mint(c.user, c.amount); // public faucet
        else IWMON(c.wmon).deposit{value: c.amount}();
    }

    function _createAndCancel(Ctx memory c) internal {
        uint256 activeBefore = c.floor.activeOrderCount();
        (uint256 stopId, uint256 tpId) = _bracket(c);
        if (c.floor.activeOrderCount() != activeBefore + 2) {
            revert SmokeFailed("bracket not active");
        }
        console2.log("bracket created:", stopId, tpId);

        c.floor.cancelOrder(stopId);
        if (
            c.floor.getOrder(stopId).status != FloorOrders.Status.CANCELLED
                || c.floor.getOrder(tpId).status != FloorOrders.Status.CANCELLED
        ) revert SmokeFailed("cancel did not close both legs");
        console2.log("bracket cancelled");
    }

    /// @dev Floor at -10%, cash-out at +20%, 1% max price difference, expires in a day.
    function _bracket(Ctx memory c) internal returns (uint256, uint256) {
        (uint256 price,,) = c.floor.oracle().getPriceE18(c.wmon);
        return c.floor
            .createBracket(
                c.wmon,
                c.usdc,
                uint128(c.amount),
                uint128(price * 90 / 100),
                uint128(price * 120 / 100),
                0,
                100,
                uint64(block.timestamp + 1 days)
            );
    }

    function _fill(Ctx memory c) internal {
        MockOracle oracle = MockOracle(address(c.floor.oracle()));
        (uint256 price,,) = oracle.getPriceE18(c.wmon);
        uint256 id = c.floor
            .createOrder(
                FloorOrders.CreateParams({
                    tokenIn: c.wmon,
                    tokenOut: c.usdc,
                    amountIn: uint128(c.amount),
                    triggerPriceE18: uint128(price * 90 / 100),
                    limitPriceE18: 0,
                    maxSlippageBps: 100,
                    kind: FloorOrders.Kind.STOP_LOSS,
                    expiry: 0
                })
            );
        oracle.setPrice(c.wmon, price * 80 / 100); // the crash
        (bool triggered,, uint256 minOut) = c.floor.checkTrigger(id);
        if (!triggered) revert SmokeFailed("not triggered after crash");

        uint256 usdcBefore = IERC20(c.usdc).balanceOf(c.user);
        _executeViaRouter(c, id, minOut);
        // The smoke user is both owner and executor here, so it receives fee + net.
        uint256 gained = IERC20(c.usdc).balanceOf(c.user) - usdcBefore;
        if (c.floor.getOrder(id).status != FloorOrders.Status.FILLED) {
            revert SmokeFailed("not filled");
        }
        if (gained < minOut) revert SmokeFailed("received below minOut");
        console2.log("filled order", id, "USDC received (6 dp):", gained);

        oracle.setPrice(c.wmon, price); // leave the demo where we found it
    }

    function _executeViaRouter(Ctx memory c, uint256 id, uint256 minOut) internal {
        bytes[] memory none;
        c.floor
            .execute(
                id,
                none,
                FloorOrders.SwapData({
                    target: c.swapTarget,
                    spender: c.swapTarget,
                    data: abi.encodeCall(
                        MockRouter.swap, (c.wmon, c.usdc, c.amount, minOut, address(c.floor))
                    )
                })
            );
    }
}
