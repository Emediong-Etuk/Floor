// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FloorOrders} from "../src/FloorOrders.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {DeployDemo} from "../script/DeployDemo.s.sol";
import {DeployLive} from "../script/DeployLive.s.sol";
import {MonadMainnet as M} from "../script/config/MonadMainnet.sol";

interface IWMON {
    function deposit() external payable;
}

/// @notice The deploy scripts' wiring, run in-process (no RPC needed), plus a demo
/// user journey on the freshly deployed contracts.
contract DeployDemoTest is Test {
    DeployDemo internal script;
    DeployDemo.Demo internal d;
    address internal operator = makeAddr("demo-panel");
    address internal user = makeAddr("judge");
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        vm.chainId(10_143);
        script = new DeployDemo();
        // The script contract makes the admin calls, so it is the owner here.
        d = script.deploy(address(script), operator, 10);
    }

    function test_wiring() public view {
        FloorOrders f = d.floor;
        assertEq(f.owner(), address(script));
        assertEq(address(f.oracle()), address(d.oracle));
        assertEq(f.executorFeeBps(), 10);
        assertTrue(f.tokenAllowed(address(d.wmon)));
        assertTrue(f.tokenAllowed(address(d.weth)));
        assertTrue(f.tokenAllowed(address(d.cbbtc)));
        assertTrue(f.tokenAllowed(address(d.usdc)));
        assertEq(f.tokenDecimals(address(d.cbbtc)), 8);
        assertEq(f.tokenDecimals(address(d.usdc)), 6);
        assertTrue(f.swapTargetAllowed(address(d.router), address(d.router)));
        assertEq(f.maxOrderUsdE18(), 0, "no cap in demo mode");
        assertEq(d.oracle.operator(), operator);
        assertEq(d.router.operator(), operator);
        assertEq(d.usdc.balanceOf(address(d.router)), 100_000_000e6);
        (uint256 p,,) = d.oracle.getPriceE18(address(d.wmon));
        assertEq(p, 0.025e18);
    }

    /// The judge flow from the demo script: faucet → protect → panel crashes price → fill.
    function test_demoJourney() public {
        vm.startPrank(user);
        d.wmon.mint(user, 10_000e18);
        d.wmon.approve(address(d.floor), 10_000e18);
        (uint256 stopId, uint256 tpId) = d.floor
            .createBracket(
                address(d.wmon), address(d.usdc), 10_000e18, 0.0225e18, 0.03e18, 0, 100, 0
            );
        vm.stopPrank();

        vm.prank(operator);
        d.oracle.setPrice(address(d.wmon), 0.02e18); // -20%
        (bool triggered,, uint256 minOut) = d.floor.checkTrigger(stopId);
        assertTrue(triggered);

        bytes[] memory none;
        FloorOrders.SwapData memory s = FloorOrders.SwapData(
            address(d.router),
            address(d.router),
            abi.encodeCall(
                MockRouter.swap,
                (address(d.wmon), address(d.usdc), 10_000e18, minOut, address(d.floor))
            )
        );
        vm.prank(keeper);
        d.floor.execute(stopId, none, s);

        assertEq(uint8(d.floor.getOrder(tpId).status), uint8(FloorOrders.Status.CANCELLED));
        uint256 gross = 200e6 * 9_980 / 10_000; // $200 less 0.2% spread
        assertEq(d.usdc.balanceOf(user), gross - gross * 10 / 10_000);
        assertEq(d.usdc.balanceOf(keeper), gross * 10 / 10_000);
    }

    function test_run_refusesWrongChain() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(DeployDemo.WrongChain.selector, 1));
        script.run();
    }
}

/// @notice DeployLive against a fork of Monad mainnet: real Pyth, real tokens, real 0x
/// AllowanceHolder. Skipped unless MONAD_MAINNET_RPC_URL is set (CI doesn't set it).
contract DeployLiveForkTest is Test {
    DeployLive internal script;
    DeployLive.Live internal l;
    address internal user = makeAddr("user");

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        script = new DeployLive();
        l = script.deploy(address(script), 10, 500, 3_900);
    }

    modifier onlyFork() {
        if (address(script) == address(0)) {
            vm.skip(true);
            return;
        }
        _;
    }

    function test_fork_wiringAndRealPrices() public onlyFork {
        FloorOrders f = l.floor;
        assertTrue(f.swapTargetAllowed(M.ZEROX_ALLOWANCE_HOLDER, M.ZEROX_ALLOWANCE_HOLDER));
        assertEq(f.maxOrderUsdE18(), 500e18);
        assertEq(f.oracleAgeFor(M.WMON), 3_900);
        assertEq(f.tokenDecimals(M.USDC), 6);
        assertEq(f.tokenDecimals(M.CBBTC), 8);
        assertEq(f.tokenDecimals(M.WMON), 18);

        address[4] memory tokens = [M.WMON, M.WETH, M.CBBTC, M.USDC];
        for (uint256 i; i < tokens.length; ++i) {
            (uint256 p, uint256 c, uint256 t) = l.adapter.getPriceE18(tokens[i]);
            assertGt(p, 0);
            assertLe(c * 10_000, p * f.maxConfBps(), "confidence within 1%");
            assertLe(block.timestamp - t, 3_900, "sponsored push feed fresh within heartbeat");
        }
        (uint256 usdc,,) = l.adapter.getPriceE18(M.USDC);
        assertApproxEqRel(usdc, 1e18, 0.02e18, "USDC within 2% of $1");
    }

    function test_fork_createCancelAndUsdCap() public onlyFork {
        vm.deal(user, 100_000 ether);
        vm.startPrank(user);
        IWMON(M.WMON).deposit{value: 10 ether}();
        IERC20(M.WMON).approve(address(l.floor), 10 ether);
        (uint256 price,,) = l.adapter.getPriceE18(M.WMON);
        (uint256 stopId, uint256 tpId) = l.floor
            .createBracket(
                M.WMON,
                M.USDC,
                10 ether,
                uint128(price * 9 / 10),
                uint128(price * 12 / 10),
                0,
                100,
                0
            );
        (bool triggered,,) = l.floor.checkTrigger(stopId);
        assertFalse(triggered);
        l.floor.cancelOrder(tpId);
        assertEq(uint8(l.floor.getOrder(stopId).status), uint8(FloorOrders.Status.CANCELLED));

        // $500 cap at the live price: just over the cap must revert.
        uint256 overCap = 501e18 * 1e18 / price;
        IWMON(M.WMON).deposit{value: overCap}();
        uint256 usd = overCap * price / 1e18;
        vm.expectRevert(abi.encodeWithSelector(FloorOrders.OrderTooLarge.selector, usd, 500e18));
        l.floor
            .createOrder(
                FloorOrders.CreateParams({
                    tokenIn: M.WMON,
                    tokenOut: M.USDC,
                    amountIn: uint128(overCap),
                    triggerPriceE18: uint128(price / 2),
                    limitPriceE18: 0,
                    maxSlippageBps: 100,
                    kind: FloorOrders.Kind.STOP_LOSS,
                    expiry: 0
                })
            );
        vm.stopPrank();
    }

    function test_run_refusesWrongChain() public {
        DeployLive s = new DeployLive();
        vm.chainId(10_143);
        vm.expectRevert(abi.encodeWithSelector(DeployLive.WrongChain.selector, 10_143));
        s.run();
    }
}
