// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FloorOrders} from "../../src/FloorOrders.sol";
import {MockOracle} from "../../src/mocks/MockOracle.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @notice Shared fixture: an 18-dec "WMON", 8-dec "WBTC", 6-dec "USDC", MockOracle,
/// a funded MockRouter and FloorOrders wired the way DeployDemo will wire them.
abstract contract Base is Test {
    FloorOrders internal floor;
    MockOracle internal oracle;
    MockRouter internal router;
    MockERC20 internal wmon;
    MockERC20 internal wbtc;
    MockERC20 internal usdc;

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    uint16 internal constant FEE_BPS = 10; // 0.1%
    uint256 internal constant MON_PRICE = 0.033e18; // $0.033
    uint256 internal constant BTC_PRICE = 100_000e18;
    uint256 internal constant USDC_PRICE = 1e18;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        wmon = new MockERC20("Wrapped MON", "WMON", 18, 1_000_000e18);
        wbtc = new MockERC20("Wrapped BTC", "WBTC", 8, 10e8);
        usdc = new MockERC20("USD Coin", "USDC", 6, 1_000_000e6);

        oracle = new MockOracle(admin);
        router = new MockRouter(admin, oracle);
        floor = new FloorOrders(admin, oracle, FEE_BPS);

        vm.startPrank(admin);
        oracle.setPrice(address(wmon), MON_PRICE);
        oracle.setPrice(address(wbtc), BTC_PRICE);
        oracle.setPrice(address(usdc), USDC_PRICE);
        floor.setTokenAllowed(address(wmon), true);
        floor.setTokenAllowed(address(wbtc), true);
        floor.setTokenAllowed(address(usdc), true);
        floor.setSwapTarget(address(router), address(router), true);
        vm.stopPrank();

        // Router liquidity (this test contract is the tokens' minter, so no cap).
        usdc.mint(address(router), 1e15 * 1e6);
        wmon.mint(address(router), 1e15 * 1e18);
        wbtc.mint(address(router), 1e9 * 1e8);

        _fund(alice, 10_000e18, 1e8);
        _fund(bob, 10_000e18, 1e8);
    }

    function _fund(address who, uint256 mon, uint256 btc) internal {
        wmon.mint(who, mon);
        wbtc.mint(who, btc);
        vm.startPrank(who);
        wmon.approve(address(floor), type(uint256).max);
        wbtc.approve(address(floor), type(uint256).max);
        vm.stopPrank();
    }

    function _params(
        MockERC20 tokenIn,
        uint128 amountIn,
        uint128 trigger,
        uint128 limit,
        uint16 slippage,
        FloorOrders.Kind kind,
        uint64 expiry
    ) internal view returns (FloorOrders.CreateParams memory) {
        return FloorOrders.CreateParams({
            tokenIn: address(tokenIn),
            tokenOut: address(usdc),
            amountIn: amountIn,
            triggerPriceE18: trigger,
            limitPriceE18: limit,
            maxSlippageBps: slippage,
            kind: kind,
            expiry: expiry
        });
    }

    /// @dev Alice protects 1,000 WMON with a floor at $0.030 and 1% slippage.
    function _aliceStop() internal returns (uint256 id) {
        vm.prank(alice);
        id = floor.createOrder(
            _params(wmon, 1_000e18, 0.03e18, 0, 100, FloorOrders.Kind.STOP_LOSS, 0)
        );
    }

    function _routerSwap(uint256 id) internal view returns (FloorOrders.SwapData memory) {
        FloorOrders.Order memory o = floor.getOrder(id);
        return FloorOrders.SwapData({
            target: address(router),
            spender: address(router),
            data: abi.encodeCall(
                MockRouter.swap, (o.tokenIn, o.tokenOut, o.amountIn, 0, address(floor))
            )
        });
    }

    function _execute(uint256 id) internal {
        bytes[] memory none;
        // Build args first: vm.prank applies to the next external call, and _routerSwap makes one.
        FloorOrders.SwapData memory s = _routerSwap(id);
        vm.prank(keeper);
        floor.execute(id, none, s);
    }

    function _setPrice(MockERC20 token, uint256 price) internal {
        vm.prank(admin);
        oracle.setPrice(address(token), price);
    }

    function _assertFloorHoldsNothing() internal view {
        assertEq(wmon.balanceOf(address(floor)), 0, "floor holds WMON");
        assertEq(wbtc.balanceOf(address(floor)), 0, "floor holds WBTC");
        assertEq(usdc.balanceOf(address(floor)), 0, "floor holds USDC");
        assertEq(address(floor).balance, 0, "floor holds MON");
    }
}
