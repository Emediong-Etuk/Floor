// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {FloorOrders} from "../src/FloorOrders.sol";
import {FloorMath} from "../src/libraries/FloorMath.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Base} from "./utils/Base.t.sol";

/// @notice Property tests over random prices, amounts, decimals, slippage, spread and fees.
contract FloorOrdersFuzzTest is Test {
    address internal admin = makeAddr("admin");
    address internal user = makeAddr("user");
    address internal executor = makeAddr("executor");

    function _decimals(uint8 seed) internal pure returns (uint8) {
        uint8[3] memory opts = [6, 8, 18];
        return opts[seed % 3];
    }

    struct World {
        MockOracle oracle;
        MockRouter router;
        FloorOrders floor;
        MockERC20 tokenIn;
        MockERC20 tokenOut;
    }

    function _world(uint8 decIn, uint8 decOut, uint256 pIn, uint256 pOut, uint16 spread, uint16 fee)
        internal
        returns (World memory w)
    {
        w.oracle = new MockOracle(admin);
        w.router = new MockRouter(admin, w.oracle);
        w.floor = new FloorOrders(admin, w.oracle, fee);
        w.tokenIn = new MockERC20("In", "IN", decIn, 0);
        w.tokenOut = new MockERC20("Out", "OUT", decOut, 0);
        vm.startPrank(admin);
        w.oracle.setPrice(address(w.tokenIn), pIn);
        w.oracle.setPrice(address(w.tokenOut), pOut);
        w.router.setSpreadBps(spread);
        w.floor.setTokenAllowed(address(w.tokenIn), true);
        w.floor.setTokenAllowed(address(w.tokenOut), true);
        w.floor.setSwapTarget(address(w.router), address(w.router), true);
        vm.stopPrank();
    }

    function _order(World memory w, uint128 amountIn, uint128 trigger, uint16 slippage)
        internal
        returns (uint256 id)
    {
        w.tokenIn.mint(user, amountIn);
        vm.startPrank(user);
        w.tokenIn.approve(address(w.floor), amountIn);
        id = w.floor
            .createOrder(
                FloorOrders.CreateParams({
                    tokenIn: address(w.tokenIn),
                    tokenOut: address(w.tokenOut),
                    amountIn: amountIn,
                    triggerPriceE18: trigger,
                    limitPriceE18: 0,
                    maxSlippageBps: slippage,
                    kind: FloorOrders.Kind.STOP_LOSS,
                    expiry: 0
                })
            );
        vm.stopPrank();
    }

    function _swap(World memory w, uint256 amountIn)
        internal
        view
        returns (FloorOrders.SwapData memory)
    {
        return FloorOrders.SwapData(
            address(w.router),
            address(w.router),
            abi.encodeCall(
                MockRouter.swap,
                (address(w.tokenIn), address(w.tokenOut), amountIn, 0, address(w.floor))
            )
        );
    }

    /// Owner always receives >= minOut - fee; fee never exceeds its cap; nothing stays behind.
    function testFuzz_fill_ownerGetsAtLeastMinOutLessFee(
        uint8 decInSeed,
        uint8 decOutSeed,
        uint256 amountSeed,
        uint256 pIn,
        uint256 pOut,
        uint16 slippage,
        uint16 spread,
        uint16 fee
    ) public {
        uint8 decIn = _decimals(decInSeed);
        uint8 decOut = _decimals(decOutSeed);
        pIn = bound(pIn, 1e10, 1e24); // $0.00000001 .. $1M
        pOut = bound(pOut, 1e15, 1e24); // $0.001 .. $1M
        slippage = uint16(bound(slippage, 0, 500));
        spread = uint16(bound(spread, 0, slippage)); // honest venue within the user's tolerance
        fee = uint16(bound(fee, 0, 50));
        uint256 amountIn = bound(amountSeed, 1, 1e9 * 10 ** decIn);

        World memory w = _world(decIn, decOut, pIn, pOut, spread, fee);
        uint256 expected = FloorMath.convert(amountIn, decIn, decOut, pIn, pOut);
        w.tokenOut.mint(address(w.router), expected + 1);
        uint256 id = _order(w, uint128(amountIn), uint128(pIn), slippage);

        uint256 minOut = FloorMath.minOut(amountIn, decIn, decOut, pIn, pOut, slippage);
        assertEq(w.floor.quoteMinOut(id, pIn, pOut), minOut);

        bytes[] memory none;
        FloorOrders.SwapData memory s = _swap(w, amountIn);
        vm.prank(executor);
        w.floor.execute(id, none, s);

        uint256 got = w.tokenOut.balanceOf(user);
        uint256 paidFee = w.tokenOut.balanceOf(executor);
        uint256 received = got + paidFee;
        assertGe(received, minOut, "venue output below minOut");
        assertGe(got, minOut - paidFee, "owner got less than minOut - fee");
        assertEq(paidFee, received * fee / 10_000, "fee math");
        assertLe(paidFee, received * 50 / 10_000, "fee above cap");
        assertEq(w.tokenIn.balanceOf(address(w.floor)), 0);
        assertEq(w.tokenOut.balanceOf(address(w.floor)), 0);
        assertEq(w.floor.getOrder(id).amountOut, got);
    }

    /// A venue paying below the user's tolerance can never fill, and the order survives.
    function testFuzz_badVenue_reverts(
        uint8 decInSeed,
        uint8 decOutSeed,
        uint256 amountSeed,
        uint256 pIn,
        uint16 slippage,
        uint16 spread
    ) public {
        uint8 decIn = _decimals(decInSeed);
        uint8 decOut = _decimals(decOutSeed);
        pIn = bound(pIn, 1e15, 1e24);
        slippage = uint16(bound(slippage, 0, 499));
        spread = uint16(bound(spread, slippage + 1, 5_000));
        uint256 amountIn = bound(amountSeed, 10 ** decIn, 1e9 * 10 ** decIn);

        World memory w = _world(decIn, decOut, pIn, 1e18, spread, 10);
        uint256 expected = FloorMath.convert(amountIn, decIn, decOut, pIn, 1e18);
        uint256 venueOut = FloorMath.lessBps(expected, spread);
        uint256 minOut = FloorMath.lessBps(expected, slippage);
        vm.assume(venueOut < minOut); // rounding can make them equal for dust amounts
        w.tokenOut.mint(address(w.router), expected);
        uint256 id = _order(w, uint128(amountIn), uint128(pIn), slippage);

        bytes[] memory none;
        FloorOrders.SwapData memory s = _swap(w, amountIn);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InsufficientOutput.selector, venueOut, minOut)
        );
        w.floor.execute(id, none, s);
        assertEq(uint8(w.floor.getOrder(id).status), uint8(FloorOrders.Status.ACTIVE));
        assertEq(w.tokenIn.balanceOf(user), amountIn);
    }

    /// FloorMath equals the plain rational formula floor(a·pIn·10^dOut / (pOut·10^dIn)) — the
    /// exact definition the TypeScript mirror in packages/shared must reproduce.
    function testFuzz_minOut_matchesReference(
        uint8 decInSeed,
        uint8 decOutSeed,
        uint64 amountIn,
        uint64 pIn,
        uint64 pOut,
        uint16 slippage
    ) public pure {
        uint8 decIn = _decimals(decInSeed);
        uint8 decOut = _decimals(decOutSeed);
        vm.assume(pIn > 0 && pOut > 0);
        slippage = uint16(bound(slippage, 0, 500));
        uint256 ref = uint256(amountIn) * pIn * 10 ** decOut / (uint256(pOut) * 10 ** decIn);
        ref = ref * (10_000 - slippage) / 10_000;
        assertEq(FloorMath.minOut(amountIn, decIn, decOut, pIn, pOut, slippage), ref);
    }

    /// The trigger rule is exactly `price <= trigger` (stop) / `price >= trigger` (take-profit).
    function testFuzz_triggerRule(uint256 price, uint128 trigger, bool takeProfit) public {
        price = bound(price, 1, type(uint128).max);
        trigger = uint128(bound(trigger, 1, type(uint128).max));
        World memory w = _world(18, 6, price, 1e18, 0, 0);
        w.tokenIn.mint(user, 1e18);
        vm.prank(user);
        uint256 id = w.floor
            .createOrder(
                FloorOrders.CreateParams({
                    tokenIn: address(w.tokenIn),
                    tokenOut: address(w.tokenOut),
                    amountIn: 1,
                    triggerPriceE18: trigger,
                    limitPriceE18: 0,
                    maxSlippageBps: 0,
                    kind: takeProfit ? FloorOrders.Kind.TAKE_PROFIT : FloorOrders.Kind.STOP_LOSS,
                    expiry: 0
                })
            );
        (bool triggered,,) = w.floor.checkTrigger(id);
        assertEq(triggered, takeProfit ? price >= trigger : price <= trigger);
    }
}

/// @notice Random sequences of create / bracket / price moves / execute / cancel / expire.
contract Handler is Test {
    FloorOrders public floor;
    MockOracle public oracle;
    MockRouter public router;
    MockERC20 public wmon;
    MockERC20 public usdc;
    address public admin;
    address[3] public users;
    address public keeper = makeAddr("handler-keeper");

    uint256 public ghostReceived;
    uint256 public ghostFees;
    uint256 public fills;

    constructor(
        FloorOrders floor_,
        MockOracle oracle_,
        MockRouter router_,
        MockERC20 wmon_,
        MockERC20 usdc_,
        address admin_
    ) {
        floor = floor_;
        oracle = oracle_;
        router = router_;
        wmon = wmon_;
        usdc = usdc_;
        admin = admin_;
        users = [makeAddr("u0"), makeAddr("u1"), makeAddr("u2")];
        for (uint256 i; i < 3; ++i) {
            vm.prank(users[i]);
            wmon.approve(address(floor), type(uint256).max);
        }
    }

    function create(uint256 who, uint256 amount, uint256 trigger, bool takeProfit) external {
        address u = users[who % 3];
        vm.prank(u);
        floor.createOrder(
            FloorOrders.CreateParams({
                tokenIn: address(wmon),
                tokenOut: address(usdc),
                amountIn: uint128(bound(amount, 1e18, 1e22)),
                triggerPriceE18: uint128(bound(trigger, 0.01e18, 0.06e18)),
                limitPriceE18: 0,
                maxSlippageBps: 100,
                kind: takeProfit ? FloorOrders.Kind.TAKE_PROFIT : FloorOrders.Kind.STOP_LOSS,
                expiry: uint64(block.timestamp + 1 days)
            })
        );
    }

    function bracket(uint256 who, uint256 amount, uint256 stop) external {
        address u = users[who % 3];
        uint128 s = uint128(bound(stop, 0.01e18, 0.05e18));
        vm.prank(u);
        floor.createBracket(
            address(wmon),
            address(usdc),
            uint128(bound(amount, 1e18, 1e22)),
            s,
            s + 0.01e18,
            0,
            100,
            0
        );
    }

    function movePrice(uint256 price) external {
        vm.prank(admin);
        oracle.setPrice(address(wmon), bound(price, 0.005e18, 0.07e18));
    }

    /// @param snapToTrigger move the price exactly onto the order's trigger first, so plenty
    /// of runs reach the fill path (both kinds fire at equality).
    function execute(uint256 pick, bool snapToTrigger) external {
        uint256 n = floor.activeOrderCount();
        if (n == 0) return;
        (uint256[] memory ids,) = floor.getActiveOrders(pick % n, 1);
        uint256 id = ids[0];
        FloorOrders.Order memory o = floor.getOrder(id);
        if (snapToTrigger) {
            vm.prank(admin);
            oracle.setPrice(address(wmon), o.triggerPriceE18);
        }
        bytes[] memory none;
        FloorOrders.SwapData memory s = FloorOrders.SwapData(
            address(router),
            address(router),
            abi.encodeCall(MockRouter.swap, (o.tokenIn, o.tokenOut, o.amountIn, 0, address(floor)))
        );
        uint256 before = usdc.balanceOf(keeper);
        vm.prank(keeper);
        try floor.execute(id, none, s) {
            FloorOrders.Order memory f = floor.getOrder(id);
            uint256 fee = usdc.balanceOf(keeper) - before;
            ghostFees += fee;
            ghostReceived += f.amountOut + fee;
            ++fills;
        } catch {}
    }

    function cancel(uint256 pick) external {
        uint256 n = floor.activeOrderCount();
        if (n == 0) return;
        (uint256[] memory ids, FloorOrders.Order[] memory os) = floor.getActiveOrders(pick % n, 1);
        vm.prank(os[0].owner);
        floor.cancelOrder(ids[0]);
    }

    function warpAndExpire(uint256 secs, uint256 pick) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
        uint256 n = floor.activeOrderCount();
        if (n == 0) return;
        (uint256[] memory ids,) = floor.getActiveOrders(pick % n, 1);
        try floor.expire(ids[0]) {} catch {}
    }
}

contract FloorOrdersInvariantTest is StdInvariant, Base {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(floor, oracle, router, wmon, usdc, admin);
        // This contract is the tokens' minter (no faucet cap). MockOracle prices read as
        // "live", so warps in the handler never make them stale.
        for (uint256 i; i < 3; ++i) {
            wmon.mint(handler.users(i), 1e30);
        }
        targetContract(address(handler));
    }

    /// §6.5 step 12: the contract never holds user funds between calls.
    function invariant_floorHoldsNoTokens() public view {
        _assertFloorHoldsNothing();
    }

    /// The active set matches order statuses exactly.
    function invariant_activeSetConsistent() public view {
        uint256 active;
        uint256 next = floor.nextOrderId();
        for (uint256 id = 1; id < next; ++id) {
            if (floor.getOrder(id).status == FloorOrders.Status.ACTIVE) ++active;
        }
        assertEq(floor.activeOrderCount(), active);
    }

    /// One-cancels-other: both legs of a bracket can never fill.
    function invariant_bracketFillsAtMostOnce() public view {
        uint256 next = floor.nextOrderId();
        for (uint256 id = 1; id < next; ++id) {
            FloorOrders.Order memory o = floor.getOrder(id);
            if (o.linkedOrderId == 0 || o.status != FloorOrders.Status.FILLED) continue;
            assertTrue(floor.getOrder(o.linkedOrderId).status != FloorOrders.Status.FILLED);
        }
    }

    function afterInvariant() public view {
        console2.log("fills in this run:", handler.fills());
    }

    /// Executor fees never exceed the configured rate.
    function invariant_feesWithinCap() public view {
        assertLe(handler.ghostFees(), handler.ghostReceived() * FEE_BPS / 10_000);
    }
}
