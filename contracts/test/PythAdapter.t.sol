// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";
import {PythAdapter} from "../src/oracles/PythAdapter.sol";
import {FloorOrders} from "../src/FloorOrders.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Rejects native refunds, to prove refund failures surface instead of being swallowed.
contract NoReceive {
    function callUpdate(PythAdapter a, bytes[] calldata data) external payable {
        a.update{value: msg.value}(data);
    }
}

contract PythAdapterTest is Test {
    // Test-only feed ids (MockPyth accepts any id). Real ids live in docs/addresses.md.
    bytes32 internal constant MON_FEED = keccak256("test MON/USD");
    bytes32 internal constant USDC_FEED = keccak256("test USDC/USD");
    uint256 internal constant UPDATE_FEE = 1 wei;

    MockPyth internal pyth;
    PythAdapter internal adapter;
    address internal admin = makeAddr("admin");
    address internal monToken = makeAddr("WMON");

    receive() external payable {}

    function setUp() public {
        vm.warp(1_800_000_000);
        pyth = new MockPyth(60, UPDATE_FEE);
        adapter = new PythAdapter(admin, IPyth(address(pyth)));
        vm.prank(admin);
        adapter.setFeed(monToken, MON_FEED);
    }

    function _update(bytes32 id, int64 price, uint64 conf, int32 expo, uint64 publishTime)
        internal
        view
        returns (bytes[] memory data)
    {
        data = new bytes[](1);
        data[0] = pyth.createPriceFeedUpdateData(id, price, conf, expo, price, conf, publishTime, 0);
    }

    function _post(bytes32 id, int64 price, uint64 conf, int32 expo, uint64 publishTime) internal {
        bytes[] memory data = _update(id, price, conf, expo, publishTime);
        adapter.update{value: UPDATE_FEE}(data);
    }

    // ---------------------------------------------------------------- conversion

    function test_toE18_acrossExpos() public view {
        assertEq(adapter.toE18(3_300_000, -8), 0.033e18); // $0.033 at expo -8
        assertEq(adapter.toE18(5, 0), 5e18);
        assertEq(adapter.toE18(5, 2), 500e18);
        assertEq(adapter.toE18(1, 18), 1e36);
        assertEq(adapter.toE18(123_456_789, -20), 1_234_567); // truncates
        assertEq(adapter.toE18(type(uint64).max, -58), 0);
    }

    function test_toE18_rejectsOutOfRangeExpo() public {
        vm.expectRevert(abi.encodeWithSelector(PythAdapter.InvalidExpo.selector, int32(19)));
        adapter.toE18(1, 19);
        vm.expectRevert(abi.encodeWithSelector(PythAdapter.InvalidExpo.selector, int32(-59)));
        adapter.toE18(1, -59);
    }

    function testFuzz_toE18_matchesReference(uint64 value, int8 rawExpo) public view {
        int32 expo = int32(bound(int256(rawExpo), -30, 10));
        uint256 got = adapter.toE18(value, expo);
        int256 shift = int256(expo) + 18;
        uint256 want = shift >= 0
            ? uint256(value) * 10 ** uint256(shift)
            : uint256(value) / 10 ** uint256(-shift);
        assertEq(got, want);
    }

    // ---------------------------------------------------------------- reads

    function test_getPriceE18_scalesPriceAndConf() public {
        _post(MON_FEED, 3_300_000, 1_650, -8, uint64(block.timestamp));
        (uint256 price, uint256 conf, uint256 t) = adapter.getPriceE18(monToken);
        assertEq(price, 0.033e18);
        assertEq(conf, 0.0000165e18);
        assertEq(t, block.timestamp);
    }

    function test_getPriceE18_rejectsZeroAndNegative() public {
        _post(MON_FEED, 0, 0, -8, uint64(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(PythAdapter.InvalidPrice.selector, int64(0)));
        adapter.getPriceE18(monToken);

        _post(MON_FEED, -5, 0, -8, uint64(block.timestamp + 1));
        vm.expectRevert(abi.encodeWithSelector(PythAdapter.InvalidPrice.selector, int64(-5)));
        adapter.getPriceE18(monToken);
    }

    function test_getPriceE18_unknownFeeds() public {
        address nobody = makeAddr("nobody");
        vm.expectRevert(abi.encodeWithSelector(PythAdapter.FeedNotSet.selector, nobody));
        adapter.getPriceE18(nobody);

        address usdcToken = makeAddr("USDC");
        vm.prank(admin);
        adapter.setFeed(usdcToken, USDC_FEED); // set, but Pyth has never seen it
        vm.expectRevert(PythErrors.PriceFeedNotFound.selector);
        adapter.getPriceE18(usdcToken);
    }

    // ---------------------------------------------------------------- update + fees

    function test_update_paysExactFeeAndRefundsRest() public {
        bytes[] memory data = _update(MON_FEED, 3_300_000, 0, -8, uint64(block.timestamp));
        assertEq(adapter.updateFee(data), UPDATE_FEE);
        uint256 before = address(this).balance;
        adapter.update{value: 1 ether}(data);
        assertEq(address(this).balance, before - UPDATE_FEE);
        assertEq(address(pyth).balance, UPDATE_FEE);
        assertEq(address(adapter).balance, 0);
    }

    function test_update_emptyIsFreeNoOp() public {
        bytes[] memory none;
        assertEq(adapter.updateFee(none), 0);
        uint256 before = address(this).balance;
        adapter.update{value: 5 wei}(none);
        assertEq(address(this).balance, before);
        adapter.update(none);
    }

    function test_update_insufficientFeeReverts() public {
        bytes[] memory data = _update(MON_FEED, 3_300_000, 0, -8, uint64(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(PythAdapter.InsufficientFee.selector, UPDATE_FEE, 0));
        adapter.update(data);
    }

    function test_update_refundFailureReverts() public {
        NoReceive caller = new NoReceive();
        bytes[] memory none;
        vm.deal(address(this), 1 ether);
        vm.expectRevert(PythAdapter.RefundFailed.selector);
        caller.callUpdate{value: 1 wei}(adapter, none);
    }

    // ---------------------------------------------------------------- admin

    function test_admin() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this))
        );
        adapter.setFeed(monToken, bytes32(0));
        vm.prank(admin);
        vm.expectRevert(PythAdapter.ZeroAddress.selector);
        adapter.setFeed(address(0), MON_FEED);
        vm.expectRevert(PythAdapter.ZeroAddress.selector);
        new PythAdapter(admin, IPyth(address(0)));
    }
}

/// @notice FloorOrders on top of the real PythAdapter + Pyth's MockPyth: both price paths of
/// D-004 (Hermes pull update in `execute`, and the cached sponsored-push price).
contract FloorOrdersWithPythTest is Test {
    bytes32 internal constant MON_FEED = keccak256("test MON/USD");
    bytes32 internal constant USDC_FEED = keccak256("test USDC/USD");

    MockPyth internal pyth;
    PythAdapter internal adapter;
    FloorOrders internal floor;
    MockRouter internal router;
    MockERC20 internal wmon;
    MockERC20 internal usdc;
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal keeper = makeAddr("keeper");
    uint256 internal id;

    function setUp() public {
        vm.warp(1_800_000_000);
        pyth = new MockPyth(60, 7 wei);
        adapter = new PythAdapter(admin, IPyth(address(pyth)));
        floor = new FloorOrders(admin, adapter, 10);
        router = new MockRouter(admin, adapter);
        wmon = new MockERC20("Wrapped MON", "WMON", 18, 0);
        usdc = new MockERC20("USD Coin", "USDC", 6, 0);

        vm.startPrank(admin);
        adapter.setFeed(address(wmon), MON_FEED);
        adapter.setFeed(address(usdc), USDC_FEED);
        floor.setTokenAllowed(address(wmon), true);
        floor.setTokenAllowed(address(usdc), true);
        floor.setSwapTarget(address(router), address(router), true);
        vm.stopPrank();

        usdc.mint(address(router), 1e12);
        wmon.mint(alice, 1_000e18);
        // Prices as Pyth publishes them: MON $0.033 (expo -8), USDC $0.9999 (expo -8).
        _post(3_300_000, 99_990_000, uint64(block.timestamp));

        vm.startPrank(alice);
        wmon.approve(address(floor), 1_000e18);
        id = floor.createOrder(
            FloorOrders.CreateParams({
                tokenIn: address(wmon),
                tokenOut: address(usdc),
                amountIn: 1_000e18,
                triggerPriceE18: 0.03e18,
                limitPriceE18: 0,
                maxSlippageBps: 100,
                kind: FloorOrders.Kind.STOP_LOSS,
                expiry: 0
            })
        );
        vm.stopPrank();
    }

    function _updates(int64 monPrice, int64 usdcPrice, uint64 t)
        internal
        view
        returns (bytes[] memory data)
    {
        data = new bytes[](2);
        data[0] = pyth.createPriceFeedUpdateData(MON_FEED, monPrice, 0, -8, monPrice, 0, t, 0);
        data[1] = pyth.createPriceFeedUpdateData(USDC_FEED, usdcPrice, 0, -8, usdcPrice, 0, t, 0);
    }

    function _post(int64 monPrice, int64 usdcPrice, uint64 t) internal {
        bytes[] memory data = _updates(monPrice, usdcPrice, t);
        adapter.update{value: 14 wei}(data);
    }

    function _swap() internal view returns (FloorOrders.SwapData memory) {
        return FloorOrders.SwapData(
            address(router),
            address(router),
            abi.encodeCall(
                MockRouter.swap, (address(wmon), address(usdc), 1_000e18, 0, address(floor))
            )
        );
    }

    function test_hermesPath_updateInsideExecute_feeExactAndRefund() public {
        vm.warp(block.timestamp + 30); // cached price now stale (default max age 15 s)
        bytes[] memory data = _updates(2_900_000, 100_000_000, uint64(block.timestamp));
        assertEq(adapter.updateFee(data), 14 wei);
        FloorOrders.SwapData memory s = _swap();
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        floor.execute{value: 1 ether}(id, data, s);

        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.FILLED));
        assertEq(floor.getOrder(id).fillPriceE18, 0.029e18);
        assertEq(keeper.balance, 1 ether - 14 wei, "only the Pyth fee is spent");
        assertEq(address(floor).balance, 0);
        assertEq(address(adapter).balance, 0);
        assertEq(wmon.balanceOf(address(floor)), 0);
        assertEq(usdc.balanceOf(address(floor)), 0);
    }

    function test_hermesPath_underpaidFeeReverts() public {
        bytes[] memory data = _updates(2_900_000, 100_000_000, uint64(block.timestamp + 1));
        FloorOrders.SwapData memory s = _swap();
        vm.deal(keeper, 13 wei);
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(FloorOrders.InsufficientFee.selector, 14 wei, 13 wei)
        );
        floor.execute{value: 13 wei}(id, data, s);
    }

    function test_pushPath_emptyUpdateUsesCachedPrice_perTokenMaxAge() public {
        // A sponsored push lands the crash price; the keeper sends no update data.
        // (Pyth only stores strictly newer publish times.)
        vm.warp(block.timestamp + 1);
        _post(2_900_000, 100_000_000, uint64(block.timestamp));
        vm.warp(block.timestamp + 600); // 10 min since the last push (price within deviation)
        bytes[] memory none;
        FloorOrders.SwapData memory s = _swap();

        vm.expectRevert(
            abi.encodeWithSelector(
                FloorOrders.StalePrice.selector, address(wmon), block.timestamp - 600
            )
        );
        floor.execute(id, none, s);

        vm.startPrank(admin);
        floor.setTokenMaxOracleAge(address(wmon), 3_900);
        floor.setTokenMaxOracleAge(address(usdc), 3_900);
        vm.stopPrank();
        vm.prank(keeper);
        floor.execute(id, none, s);
        assertEq(uint8(floor.getOrder(id).status), uint8(FloorOrders.Status.FILLED));
    }

    function test_negativePythPriceBlocksExecute() public {
        bytes[] memory data = _updates(-1, 100_000_000, uint64(block.timestamp + 1));
        FloorOrders.SwapData memory s = _swap();
        vm.deal(keeper, 14 wei);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PythAdapter.InvalidPrice.selector, int64(-1)));
        floor.execute{value: 14 wei}(id, data, s);
    }
}
