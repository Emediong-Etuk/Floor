// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./utils/Base.t.sol";
import {FloorOrders} from "../src/FloorOrders.sol";
import {IFloorOracle} from "../src/interfaces/IFloorOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MaliciousRouter} from "./mocks/MaliciousRouter.sol";

contract FloorOrdersTest is Base {
    // ================================================================ create

    function test_createOrder_storesOrderAndIndexes() public {
        vm.expectEmit(true, true, false, true);
        emit FloorOrders.OrderCreated(
            1,
            alice,
            FloorOrders.Kind.STOP_LOSS,
            address(wmon),
            address(usdc),
            1_000e18,
            0.03e18,
            0,
            100,
            0
        );
        uint256 id = _aliceStop();

        assertEq(id, 1);
        FloorOrders.Order memory o = floor.getOrder(id);
        assertEq(o.owner, alice);
        assertEq(o.tokenIn, address(wmon));
        assertEq(o.tokenOut, address(usdc));
        assertEq(o.amountIn, 1_000e18);
        assertEq(o.triggerPriceE18, 0.03e18);
        assertEq(o.maxSlippageBps, 100);
        assertEq(uint8(o.status), uint8(FloorOrders.Status.ACTIVE));
        assertEq(o.createdAt, block.timestamp);
        assertEq(floor.activeOrderCount(), 1);
        assertEq(floor.ownerOrderCount(alice), 1);
        assertEq(floor.nextOrderId(), 2);
    }

    function test_createOrder_validation() public {
        vm.startPrank(alice);
        MockERC20 rogue = new MockERC20("Rogue", "RGE", 18, 1);
        FloorOrders.CreateParams memory p =
            _params(wmon, 1e18, 0.03e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0);

        p.tokenIn = address(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.TokenNotAllowed.selector, address(rogue))
        );
        floor.createOrder(p);

        p.tokenIn = address(wmon);
        p.tokenOut = address(rogue);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.TokenNotAllowed.selector, address(rogue))
        );
        floor.createOrder(p);

        p.tokenOut = address(wmon);
        vm.expectRevert(FloorOrders.SameToken.selector);
        floor.createOrder(p);

        p.tokenOut = address(usdc);
        p.amountIn = 0;
        vm.expectRevert(FloorOrders.ZeroAmount.selector);
        floor.createOrder(p);

        p.amountIn = 1e18;
        p.maxSlippageBps = 501;
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.SlippageTooHigh.selector, 501));
        floor.createOrder(p);

        p.maxSlippageBps = 100;
        p.expiry = uint64(block.timestamp);
        vm.expectRevert(FloorOrders.InvalidExpiry.selector);
        floor.createOrder(p);

        p.expiry = 0;
        p.triggerPriceE18 = 0;
        vm.expectRevert(FloorOrders.InvalidTriggerPrice.selector);
        floor.createOrder(p);

        p.triggerPriceE18 = 0.03e18;
        p.limitPriceE18 = 0.03e18; // limit must be below the floor
        vm.expectRevert(FloorOrders.InvalidLimitPrice.selector);
        floor.createOrder(p);

        p.kind = FloorOrders.Kind.TAKE_PROFIT;
        p.limitPriceE18 = 0.01e18; // take-profit has no stop-limit
        vm.expectRevert(FloorOrders.InvalidLimitPrice.selector);
        floor.createOrder(p);
        vm.stopPrank();
    }

    function test_createOrder_usdCap() public {
        vm.prank(admin);
        floor.setMaxOrderUsdE18(30e18); // 1,000 WMON at $0.033 = $33
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.OrderTooLarge.selector, 33e18, 30e18));
        floor.createOrder(_params(wmon, 1_000e18, 0.03e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0));

        vm.prank(admin);
        floor.setMaxOrderUsdE18(500e18);
        _aliceStop();
        assertEq(floor.activeOrderCount(), 1);

        // 8-decimal token: 0.01 BTC = $1,000 > $500
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.OrderTooLarge.selector, 1_000e18, 500e18)
        );
        floor.createOrder(_params(wbtc, 0.01e8, 90_000e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0));
    }

    function test_pause_blocksCreateAndExecuteButNotCancel() public {
        uint256 id = _aliceStop();
        vm.prank(admin);
        floor.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        floor.createOrder(_params(wmon, 1e18, 0.03e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0));

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        floor.updateOrder(id, 0.02e18, 0, 100, 0);

        _setPrice(wmon, 0.02e18);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        floor.execute(id, none, s);

        vm.prank(alice);
        floor.cancelOrder(id);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.CANCELLED));

        vm.prank(admin);
        floor.unpause();
        _aliceStop();
    }

    // ================================================================ update / cancel

    function test_updateOrder_ownerOnlyActiveOnly() public {
        uint256 id = _aliceStop();

        vm.prank(bob);
        vm.expectRevert(FloorOrders.NotOrderOwner.selector);
        floor.updateOrder(id, 0.02e18, 0, 100, 0);

        vm.expectEmit(true, false, false, true);
        emit FloorOrders.OrderUpdated(id, 0.025e18, 0.02e18, 200, uint64(block.timestamp + 1 days));
        vm.prank(alice);
        floor.updateOrder(id, 0.025e18, 0.02e18, 200, uint64(block.timestamp + 1 days));
        FloorOrders.Order memory o = floor.getOrder(id);
        assertEq(o.triggerPriceE18, 0.025e18);
        assertEq(o.limitPriceE18, 0.02e18);
        assertEq(o.maxSlippageBps, 200);
        assertEq(o.expiry, block.timestamp + 1 days);

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.SlippageTooHigh.selector, 501));
        floor.updateOrder(id, 0.025e18, 0, 501, 0);
        vm.expectRevert(FloorOrders.InvalidExpiry.selector);
        floor.updateOrder(id, 0.025e18, 0, 100, uint64(block.timestamp));
        vm.expectRevert(FloorOrders.InvalidLimitPrice.selector);
        floor.updateOrder(id, 0.025e18, 0.026e18, 100, 0);

        floor.cancelOrder(id);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, id));
        floor.updateOrder(id, 0.02e18, 0, 100, 0);
        vm.stopPrank();
    }

    function test_cancelOrder_ownerOnlyActiveOnly() public {
        uint256 id = _aliceStop();
        vm.prank(bob);
        vm.expectRevert(FloorOrders.NotOrderOwner.selector);
        floor.cancelOrder(id);

        vm.expectEmit(true, true, false, false);
        emit FloorOrders.OrderCancelled(id, alice);
        vm.prank(alice);
        floor.cancelOrder(id);
        assertEq(floor.activeOrderCount(), 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, id));
        floor.cancelOrder(id);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, 99));
        floor.cancelOrder(99);
    }

    // ================================================================ execute: triggers

    function test_stopLoss_firesAtAndBelowTriggerNotAbove() public {
        uint256 id = _aliceStop();
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);

        _setPrice(wmon, 0.0301e18);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.NotTriggered.selector, 0.0301e18, 0.03e18)
        );
        floor.execute(id, none, s);

        _setPrice(wmon, 0.03e18); // exactly at the floor
        _execute(id);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.FILLED));

        uint256 id2 = _aliceStop();
        _setPrice(wmon, 0.01e18); // far below
        _execute(id2);
        assertEq(uint8(floor.getOrder(id2).status), uint8(FloorOrders.Status.FILLED));
        _assertFloorHoldsNothing();
    }

    function test_takeProfit_firesAtAndAboveNotBelow() public {
        vm.prank(alice);
        uint256 id = floor.createOrder(
            _params(wmon, 1_000e18, 0.04e18, 0, 100, FloorOrders.Kind.TAKE_PROFIT, 0)
        );
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);

        _setPrice(wmon, 0.0399e18);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.NotTriggered.selector, 0.0399e18, 0.04e18)
        );
        floor.execute(id, none, s);

        _setPrice(wmon, 0.04e18);
        _execute(id);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.FILLED));

        vm.prank(alice);
        uint256 id2 = floor.createOrder(
            _params(wmon, 1_000e18, 0.04e18, 0, 100, FloorOrders.Kind.TAKE_PROFIT, 0)
        );
        _setPrice(wmon, 0.08e18);
        _execute(id2);
        assertEq(uint8(floor.getOrder(id2).status), uint8(FloorOrders.Status.FILLED));
    }

    function test_stopLimit_respectsNeverSellBelow() public {
        vm.prank(alice);
        uint256 id = floor.createOrder(
            _params(wmon, 1_000e18, 0.03e18, 0.025e18, 100, FloorOrders.Kind.STOP_LOSS, 0)
        );
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);

        _setPrice(wmon, 0.0249e18); // crashed through the limit: hold, don't dump
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.NotTriggered.selector, 0.0249e18, 0.03e18)
        );
        floor.execute(id, none, s);
        (bool triggered,,) = floor.checkTrigger(id);
        assertFalse(triggered);

        _setPrice(wmon, 0.025e18); // at the limit: allowed
        _execute(id);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.FILLED));
    }

    // ================================================================ execute: payouts

    function test_execute_paysOwnerAndExecutorAndRecordsFill() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);

        // 1,000 WMON × $0.029 = 29 USDC; router spread 0.2% → 28.942; fee 0.1% → 0.028942
        uint256 gross = 28_942_000;
        uint256 fee = 28_942;
        uint256 net = gross - fee;
        uint256 monBefore = wmon.balanceOf(alice);

        vm.expectEmit(true, true, true, true);
        emit FloorOrders.OrderFilled(id, alice, keeper, 0.029e18, 1_000e18, net, fee);
        _execute(id);

        assertEq(usdc.balanceOf(alice), net);
        assertEq(usdc.balanceOf(keeper), fee);
        assertEq(wmon.balanceOf(alice), monBefore - 1_000e18);
        FloorOrders.Order memory o = floor.getOrder(id);
        assertEq(o.amountOut, net);
        assertEq(o.fillPriceE18, 0.029e18);
        assertEq(o.filledAt, block.timestamp);
        assertEq(floor.activeOrderCount(), 0);
        assertEq(wmon.allowance(address(floor), address(router)), 0, "approval not reset");
        _assertFloorHoldsNothing();
    }

    function test_execute_decimals_8to6_and_6to18() public {
        // 0.01 WBTC (8 dec) → USDC (6 dec) at $90,000: 900 USDC gross.
        vm.prank(alice);
        uint256 id = floor.createOrder(
            _params(wbtc, 0.01e8, 95_000e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0)
        );
        _setPrice(wbtc, 90_000e18);
        _execute(id);
        uint256 gross = 900e6 * 9_980 / 10_000;
        assertEq(usdc.balanceOf(alice), gross - gross * FEE_BPS / 10_000);

        // 100 USDC (6 dec) → WMON (18 dec) if USDC depegs to $0.98: 100×0.98/0.033 WMON.
        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(floor), 100e6);
        uint256 id2 = floor.createOrder(
            FloorOrders.CreateParams({
                tokenIn: address(usdc),
                tokenOut: address(wmon),
                amountIn: 100e6,
                triggerPriceE18: 0.99e18,
                limitPriceE18: 0,
                maxSlippageBps: 100,
                kind: FloorOrders.Kind.STOP_LOSS,
                expiry: 0
            })
        );
        vm.stopPrank();
        _setPrice(usdc, 0.98e18);
        uint256 monBefore = wmon.balanceOf(bob);
        _execute(id2);
        uint256 out = uint256(100e6) * 1e12 * 0.98e18 / MON_PRICE;
        uint256 gross2 = out * 9_980 / 10_000;
        assertEq(wmon.balanceOf(bob) - monBefore, gross2 - gross2 * FEE_BPS / 10_000);
        _assertFloorHoldsNothing();
    }

    function test_execute_zeroFee() public {
        vm.prank(admin);
        floor.setExecutorFeeBps(0);
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        _execute(id);
        assertEq(usdc.balanceOf(keeper), 0);
        assertEq(usdc.balanceOf(alice), 28_942_000);
    }

    function test_execute_refundsNativeValue() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        vm.deal(keeper, 1 ether);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.prank(keeper);
        floor.execute{value: 1 ether}(id, none, s);
        assertEq(keeper.balance, 1 ether, "MockOracle fee is 0: everything refunded");
        _assertFloorHoldsNothing();
    }

    // ================================================================ execute: protections

    function test_execute_routerBelowMinOut_revertsAndOrderStaysActive() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        vm.prank(admin);
        router.setLiquidityGap(true, 300); // pays 3.2% under oracle; user allows 1%

        uint256 monBefore = wmon.balanceOf(alice);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InsufficientOutput.selector, 28_072_000, 28_710_000)
        );
        floor.execute(id, none, s);

        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.ACTIVE));
        assertEq(wmon.balanceOf(alice), monBefore);
        assertEq(floor.activeOrderCount(), 1);

        vm.prank(admin);
        router.setLiquidityGap(false, 0);
        _execute(id);
    }

    function test_execute_stalePriceReverts_perTokenAgeOverride() public {
        uint256 id = _aliceStop();
        vm.prank(admin);
        oracle.setPriceWithMeta(address(wmon), 0.029e18, 0, uint64(block.timestamp - 16));
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.StalePrice.selector, address(wmon), block.timestamp - 16
            )
        );
        floor.execute(id, none, s);

        // D-004: sponsored push feeds only → per-token age ≈ heartbeat + margin.
        vm.prank(admin);
        floor.setTokenMaxOracleAge(address(wmon), 3_900);
        assertEq(floor.oracleAgeFor(address(wmon)), 3_900);
        assertEq(floor.oracleAgeFor(address(usdc)), 15);
        _execute(id);
    }

    function test_execute_futurePublishTimeCountsAsFresh() public {
        uint256 id = _aliceStop();
        vm.prank(admin);
        oracle.setPriceWithMeta(address(wmon), 0.029e18, 0, uint64(block.timestamp + 1));
        _execute(id);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.FILLED));
    }

    function test_execute_staleTokenOutPriceReverts() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        vm.prank(admin);
        oracle.setPriceWithMeta(address(usdc), 1e18, 0, uint64(block.timestamp - 100));
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.StalePrice.selector, address(usdc), block.timestamp - 100
            )
        );
        floor.execute(id, none, s);
    }

    function test_execute_wideConfidenceReverts() public {
        uint256 id = _aliceStop();
        vm.prank(admin);
        oracle.setPriceWithMeta(address(wmon), 0.029e18, 0.0003e18, 0); // 1.03% > 1%
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.PriceTooUncertain.selector, address(wmon), 0.0003e18, 0.029e18
            )
        );
        floor.execute(id, none, s);

        vm.prank(admin);
        oracle.setPriceWithMeta(address(wmon), 0.029e18, 0.00029e18, 0); // exactly 1%: ok
        _execute(id);
    }

    function test_execute_nonAllowlistedTargetReverts_tokenDrainAttempt() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        // Classic approval drain: make FloorOrders call wmon.transferFrom(bob → attacker).
        address attacker = makeAddr("attacker");
        FloorOrders.SwapData memory evil = FloorOrders.SwapData({
            target: address(wmon),
            spender: address(wmon),
            data: abi.encodeCall(IERC20.transferFrom, (bob, attacker, 10_000e18))
        });
        bytes[] memory none;
        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.SwapTargetNotAllowed.selector, address(wmon), address(wmon)
            )
        );
        floor.execute(id, none, evil);

        // Allowlisted target with an unlisted spender also fails.
        evil.target = address(router);
        evil.spender = attacker;
        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.SwapTargetNotAllowed.selector, address(router), attacker
            )
        );
        floor.execute(id, none, evil);
        assertEq(wmon.balanceOf(attacker), 0);
    }

    function test_execute_userMovedTokensOrCutAllowance() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);

        uint256 bal = wmon.balanceOf(alice);
        vm.prank(alice);
        wmon.transfer(bob, bal - 1e18); // keeps 1 WMON
        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.InsufficientBalanceOrAllowance.selector,
                1e18,
                type(uint256).max,
                1_000e18
            )
        );
        floor.execute(id, none, s);

        vm.prank(bob);
        wmon.transfer(alice, bal - 1e18);
        vm.prank(alice);
        wmon.approve(address(floor), 10e18);
        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.InsufficientBalanceOrAllowance.selector, bal, 10e18, 1_000e18
            )
        );
        floor.execute(id, none, s);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.ACTIVE));
    }

    function test_execute_tokenDelistedAfterCreation() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        vm.prank(admin);
        floor.setTokenAllowed(address(wmon), false);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.TokenNotAllowed.selector, address(wmon)));
        floor.execute(id, none, s);

        vm.prank(admin);
        floor.setTokenAllowed(address(usdc), false);
        vm.prank(admin);
        floor.setTokenAllowed(address(wmon), true);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.TokenNotAllowed.selector, address(usdc)));
        floor.execute(id, none, s);

        // The user can still cancel.
        vm.prank(alice);
        floor.cancelOrder(id);
    }

    function test_execute_inactiveOrUnknownOrderReverts() public {
        bytes[] memory none;
        FloorOrders.SwapData memory s;
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, 42));
        floor.execute(42, none, s);
    }

    function test_execute_venueRevertReasonBubblesUp() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        FloorOrders.SwapData memory s = _routerSwap(id);
        // Ask the router for an impossible minimum: its own error must surface.
        s.data = abi.encodeCall(
            MockRouter.swap, (address(wmon), address(usdc), 1_000e18, 1e30, address(floor))
        );
        bytes[] memory none;
        vm.expectRevert(
            abi.encodeWithSelector(MockRouter.InsufficientOutput.selector, 28_942_000, 1e30)
        );
        floor.execute(id, none, s);

        // A venue that reverts with no data → SwapFailed.
        s.data = hex"deadbeef";
        vm.expectRevert(FloorOrders.SwapFailed.selector);
        floor.execute(id, none, s);
    }

    // ================================================================ expiry

    function test_expiry_executeRevertsAndAnyoneCanExpire() public {
        vm.prank(alice);
        uint256 id = floor.createOrder(
            _params(
                wmon,
                1_000e18,
                0.03e18,
                0,
                100,
                FloorOrders.Kind.STOP_LOSS,
                uint64(block.timestamp + 1 days)
            )
        );
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotExpired.selector, id));
        floor.expire(id);

        vm.warp(block.timestamp + 1 days);
        _setPrice(wmon, 0.02e18);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.Expired.selector, id));
        floor.execute(id, none, s);
        (bool triggered,,) = floor.checkTrigger(id);
        assertFalse(triggered);

        vm.expectEmit(true, true, false, false);
        emit FloorOrders.OrderExpired(id, alice);
        vm.prank(bob); // anyone
        floor.expire(id);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.EXPIRED));
        assertEq(floor.activeOrderCount(), 0);

        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, id));
        floor.expire(id);
    }

    // ================================================================ bracket (OCO)

    function _aliceBracket() internal returns (uint256 stopId, uint256 tpId) {
        vm.prank(alice);
        (stopId, tpId) = floor.createBracket(
            address(wmon), address(usdc), 1_000e18, 0.03e18, 0.04e18, 0, 100, 0
        );
    }

    function test_bracket_createLinksLegs() public {
        vm.expectEmit(true, true, true, false);
        emit FloorOrders.BracketCreated(1, 2, alice);
        (uint256 stopId, uint256 tpId) = _aliceBracket();
        FloorOrders.Order memory s = floor.getOrder(stopId);
        FloorOrders.Order memory t = floor.getOrder(tpId);
        assertEq(uint8(s.kind), uint8(FloorOrders.Kind.STOP_LOSS));
        assertEq(uint8(t.kind), uint8(FloorOrders.Kind.TAKE_PROFIT));
        assertEq(s.linkedOrderId, tpId);
        assertEq(t.linkedOrderId, stopId);
        assertEq(floor.activeOrderCount(), 2);

        vm.prank(alice);
        vm.expectRevert(FloorOrders.InvalidBracketPrices.selector);
        floor.createBracket(address(wmon), address(usdc), 1e18, 0.04e18, 0.04e18, 0, 100, 0);
    }

    function test_bracket_stopFillCancelsTakeProfit() public {
        (uint256 stopId, uint256 tpId) = _aliceBracket();
        _setPrice(wmon, 0.029e18);
        vm.expectEmit(true, true, false, false);
        emit FloorOrders.OrderCancelled(tpId, alice);
        _execute(stopId);

        assertEq(uint8(floor.getOrder(tpId).status), uint8(FloorOrders.Status.CANCELLED));
        assertEq(floor.activeOrderCount(), 0);

        // The other leg can never fill, even if its price is hit later.
        _setPrice(wmon, 0.05e18);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(tpId);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, tpId));
        floor.execute(tpId, none, s);
    }

    function test_bracket_takeProfitFillCancelsStop() public {
        (uint256 stopId, uint256 tpId) = _aliceBracket();
        _setPrice(wmon, 0.041e18);
        _execute(tpId);
        assertEq(uint8(floor.getOrder(stopId).status), uint8(FloorOrders.Status.CANCELLED));
        _setPrice(wmon, 0.01e18);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _routerSwap(stopId);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, stopId));
        floor.execute(stopId, none, s);
    }

    function test_bracket_cancelOneCancelsBoth() public {
        (uint256 stopId, uint256 tpId) = _aliceBracket();
        vm.prank(alice);
        floor.cancelOrder(tpId);
        assertEq(uint8(floor.getOrder(stopId).status), uint8(FloorOrders.Status.CANCELLED));
        assertEq(uint8(floor.getOrder(tpId).status), uint8(FloorOrders.Status.CANCELLED));
        assertEq(floor.activeOrderCount(), 0);
    }

    function test_bracket_updateKeepsFloorBelowCashOut() public {
        (uint256 stopId, uint256 tpId) = _aliceBracket();
        vm.startPrank(alice);
        vm.expectRevert(FloorOrders.InvalidBracketPrices.selector);
        floor.updateOrder(stopId, 0.04e18, 0, 100, 0);
        vm.expectRevert(FloorOrders.InvalidBracketPrices.selector);
        floor.updateOrder(tpId, 0.03e18, 0, 100, 0);
        floor.updateOrder(stopId, 0.035e18, 0, 100, 0);
        floor.updateOrder(tpId, 0.036e18, 0, 100, 0);
        vm.stopPrank();
    }

    function test_bracket_expiredLegCanBeExpiredAlone() public {
        vm.prank(alice);
        (uint256 stopId, uint256 tpId) = floor.createBracket(
            address(wmon),
            address(usdc),
            1_000e18,
            0.03e18,
            0.04e18,
            0,
            100,
            uint64(block.timestamp + 1 days)
        );
        vm.warp(block.timestamp + 2 days);
        floor.expire(stopId);
        floor.expire(tpId);
        assertEq(floor.activeOrderCount(), 0);
    }

    // ================================================================ hostile venue

    function _malicious(MaliciousRouter.Mode mode, uint256 targetId, address victim)
        internal
        returns (MaliciousRouter evil)
    {
        evil = new MaliciousRouter(floor, router);
        evil.configure(mode, targetId, victim);
        vm.prank(admin);
        floor.setSwapTarget(address(evil), address(evil), true);
    }

    function _evilSwap(MaliciousRouter evil, uint256 id, uint256 minOut)
        internal
        view
        returns (FloorOrders.SwapData memory)
    {
        FloorOrders.Order memory o = floor.getOrder(id);
        return FloorOrders.SwapData({
            target: address(evil),
            spender: address(evil),
            data: abi.encodeCall(
                MaliciousRouter.swap, (o.tokenIn, o.tokenOut, o.amountIn, minOut, address(floor))
            )
        });
    }

    function test_malicious_reentrantExecuteFails() public {
        uint256 id = _aliceStop();
        vm.prank(bob);
        uint256 other = floor.createOrder(
            _params(wmon, 1_000e18, 0.03e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0)
        );
        _setPrice(wmon, 0.029e18);
        MaliciousRouter evil = _malicious(MaliciousRouter.Mode.REENTER_EXECUTE, other, address(0));
        bytes[] memory none;
        FloorOrders.SwapData memory s = _evilSwap(evil, id, 0);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        floor.execute(id, none, s);
        assertEq(floor.activeOrderCount(), 2);
    }

    function test_malicious_reentrantCancelFails() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        MaliciousRouter evil = _malicious(MaliciousRouter.Mode.REENTER_CANCEL, id, address(0));
        bytes[] memory none;
        FloorOrders.SwapData memory s = _evilSwap(evil, id, 0);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        floor.execute(id, none, s);
    }

    function test_malicious_payShortFails() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        MaliciousRouter evil = _malicious(MaliciousRouter.Mode.PAY_SHORT, id, address(0));
        usdc.mint(address(evil), 1_000e6);
        (,, uint256 minOut) = floor.checkTrigger(id);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _evilSwap(evil, id, minOut);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InsufficientOutput.selector, minOut / 2, minOut)
        );
        floor.execute(id, none, s);
    }

    function test_malicious_cannotMoveThirdPartyApprovals() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        MaliciousRouter evil = _malicious(MaliciousRouter.Mode.STEAL_VICTIM, id, bob);
        uint256 bobBefore = wmon.balanceOf(bob);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _evilSwap(evil, id, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(evil), 0, 1_000e18
            )
        );
        floor.execute(id, none, s);
        assertEq(wmon.balanceOf(bob), bobBefore);
    }

    function test_malicious_cannotPullMoreThanAmountIn() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        MaliciousRouter evil = _malicious(MaliciousRouter.Mode.PULL_EXTRA, id, address(0));
        bytes[] memory none;
        FloorOrders.SwapData memory s = _evilSwap(evil, id, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector,
                address(evil),
                1_000e18,
                1_000e18 + 1
            )
        );
        floor.execute(id, none, s);
    }

    function test_partialPull_refundsLeftoverInputToOwner() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        MaliciousRouter evil = _malicious(MaliciousRouter.Mode.PARTIAL_PULL, id, address(0));
        usdc.mint(address(evil), 1_000e6);
        (,, uint256 minOut) = floor.checkTrigger(id);
        uint256 monBefore = wmon.balanceOf(alice);
        bytes[] memory none;
        FloorOrders.SwapData memory s = _evilSwap(evil, id, minOut);
        vm.prank(keeper);
        floor.execute(id, none, s);
        assertEq(wmon.balanceOf(alice), monBefore - 500e18, "half refunded");
        assertEq(wmon.allowance(address(floor), address(evil)), 0, "approval reset");
        _assertFloorHoldsNothing();
    }

    function test_honestWrappedVenueFills() public {
        uint256 id = _aliceStop();
        _setPrice(wmon, 0.029e18);
        MaliciousRouter evil = _malicious(MaliciousRouter.Mode.HONEST, id, address(0));
        bytes[] memory none;
        FloorOrders.SwapData memory s = _evilSwap(evil, id, 0);
        floor.execute(id, none, s);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.FILLED));
        _assertFloorHoldsNothing();
    }

    // ================================================================ admin

    function test_admin_onlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob);
        vm.startPrank(bob);
        vm.expectRevert(err);
        floor.setOracle(oracle);
        vm.expectRevert(err);
        floor.setTokenAllowed(address(wmon), false);
        vm.expectRevert(err);
        floor.setSwapTarget(address(router), address(router), false);
        vm.expectRevert(err);
        floor.setExecutorFeeBps(1);
        vm.expectRevert(err);
        floor.setMaxOracleAge(1);
        vm.expectRevert(err);
        floor.setTokenMaxOracleAge(address(wmon), 1);
        vm.expectRevert(err);
        floor.setMaxConfBps(1);
        vm.expectRevert(err);
        floor.setMaxOrderUsdE18(1);
        vm.expectRevert(err);
        floor.pause();
        vm.expectRevert(err);
        floor.unpause();
        vm.stopPrank();
    }

    function test_admin_boundsAndEvents() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.FeeTooHigh.selector, 51));
        floor.setExecutorFeeBps(51);
        vm.expectEmit(false, false, false, true);
        emit FloorOrders.ExecutorFeeSet(50);
        floor.setExecutorFeeBps(50);

        vm.expectRevert(FloorOrders.InvalidConfBps.selector);
        floor.setMaxConfBps(0);
        vm.expectRevert(FloorOrders.InvalidConfBps.selector);
        floor.setMaxConfBps(10_001);
        floor.setMaxConfBps(200);
        assertEq(floor.maxConfBps(), 200);

        vm.expectRevert(FloorOrders.InvalidExpiry.selector);
        floor.setMaxOracleAge(0);
        floor.setMaxOracleAge(60);
        assertEq(floor.maxOracleAge(), 60);

        vm.expectRevert(FloorOrders.ZeroAddress.selector);
        floor.setOracle(IFloorOracle(address(0)));
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(FloorOrders.FeeTooHigh.selector, 51));
        new FloorOrders(admin, oracle, 51);
    }

    function test_admin_swapTargetCannotBeTokenOrSelf() public {
        vm.startPrank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InvalidSwapTarget.selector, address(wmon))
        );
        floor.setSwapTarget(address(wmon), address(router), true);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InvalidSwapTarget.selector, address(usdc))
        );
        floor.setSwapTarget(address(router), address(usdc), true);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InvalidSwapTarget.selector, address(floor))
        );
        floor.setSwapTarget(address(floor), address(router), true);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InvalidSwapTarget.selector, address(router))
        );
        floor.setSwapTarget(address(router), address(floor), true);
        address eoa = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.InvalidSwapTarget.selector, eoa));
        floor.setSwapTarget(eoa, eoa, true);
        vm.expectRevert(FloorOrders.ZeroAddress.selector);
        floor.setSwapTarget(address(0), address(router), true);

        // ...and a venue can't later be allowlisted as a token.
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InvalidSwapTarget.selector, address(router))
        );
        floor.setTokenAllowed(address(router), true);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InvalidSwapTarget.selector, address(floor))
        );
        floor.setTokenAllowed(address(floor), true);
        vm.expectRevert(FloorOrders.ZeroAddress.selector);
        floor.setTokenAllowed(address(0), true);

        // Removing the venue frees the address (refcount back to 0); repeat calls are no-ops.
        floor.setSwapTarget(address(router), address(router), false);
        floor.setSwapTarget(address(router), address(router), false);
        assertEq(floor.venueRefCount(address(router)), 0);
        assertFalse(floor.swapTargetAllowed(address(router), address(router)));
        vm.stopPrank();
    }

    function test_admin_rejectsTokensOver18Decimals() public {
        MockERC20 weird = new MockERC20("Weird", "WRD", 19, 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.UnsupportedDecimals.selector, 19));
        floor.setTokenAllowed(address(weird), true);
    }

    function test_admin_ownable2Step() public {
        vm.prank(admin);
        floor.transferOwnership(bob);
        assertEq(floor.owner(), admin);
        vm.prank(bob);
        floor.acceptOwnership();
        assertEq(floor.owner(), bob);
    }

    // ================================================================ views

    function test_views_pagination() public {
        uint256[] memory ids = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            ids[i] = _aliceStop();
        }
        vm.prank(bob);
        floor.createOrder(_params(wmon, 1e18, 0.03e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0));

        (uint256[] memory page,) = floor.getOrdersByOwner(alice, 0, 2);
        assertEq(page.length, 2);
        assertEq(page[0], ids[4], "newest first");
        assertEq(page[1], ids[3]);
        (page,) = floor.getOrdersByOwner(alice, 4, 10);
        assertEq(page.length, 1);
        assertEq(page[0], ids[0]);
        (page,) = floor.getOrdersByOwner(alice, 5, 10);
        assertEq(page.length, 0);

        assertEq(floor.activeOrderCount(), 6);
        vm.prank(alice);
        floor.cancelOrder(ids[1]); // swap-and-pop keeps the set dense
        (uint256[] memory active, FloorOrders.Order[] memory orders) = floor.getActiveOrders(0, 100);
        assertEq(active.length, 5);
        for (uint256 i; i < active.length; ++i) {
            assertTrue(active[i] != ids[1]);
            assertEq(uint8(orders[i].status), uint8(FloorOrders.Status.ACTIVE));
        }
        (active,) = floor.getActiveOrders(3, 100);
        assertEq(active.length, 2);
        (active,) = floor.getActiveOrders(9, 1);
        assertEq(active.length, 0);
    }

    function test_views_checkTriggerAndQuoteMinOut() public {
        uint256 id = _aliceStop();
        (bool triggered, uint256 price, uint256 minOut) = floor.checkTrigger(id);
        assertFalse(triggered);
        assertEq(price, MON_PRICE);
        assertEq(minOut, 33e6 * 99 / 100);

        _setPrice(wmon, 0.029e18);
        (triggered, price, minOut) = floor.checkTrigger(id);
        assertTrue(triggered);
        assertEq(minOut, 28_710_000);
        assertEq(floor.quoteMinOut(id, 0.029e18, 1e18), minOut);

        (triggered,,) = floor.checkTrigger(999);
        assertFalse(triggered);
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.NotActive.selector, 999));
        floor.quoteMinOut(999, 1, 1);
    }
}
