// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./utils/Base.t.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice The demo mocks are deployed publicly on testnet, so their permissions matter too.
contract MocksTest is Base {
    address internal operator = makeAddr("operator");

    function test_mockERC20_faucetCap() public {
        vm.prank(bob);
        wmon.mint(bob, 1_000_000e18); // exactly the cap is fine
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                MockERC20.MintCapExceeded.selector, 1_000_000e18 + 1, 1_000_000e18
            )
        );
        wmon.mint(bob, 1_000_000e18 + 1);
        assertEq(wbtc.decimals(), 8);
    }

    function test_mockOracle_operatorAndValidation() public {
        vm.prank(bob);
        vm.expectRevert(MockOracle.NotAuthorized.selector);
        oracle.setPrice(address(wmon), 1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        oracle.setOperator(bob);

        vm.prank(admin);
        oracle.setOperator(operator);
        vm.startPrank(operator);
        oracle.setPrice(address(wmon), 0.02e18);
        vm.expectRevert(MockOracle.InvalidPrice.selector);
        oracle.setPrice(address(wmon), 0);
        vm.expectRevert(MockOracle.InvalidPrice.selector);
        oracle.setPrice(address(wmon), uint256(type(uint128).max) + 1);
        vm.expectRevert(MockOracle.InvalidPrice.selector);
        oracle.setPriceWithMeta(address(wmon), 1, uint256(type(uint128).max) + 1, 0);
        vm.stopPrank();

        (uint256 p,, uint256 t) = oracle.getPriceE18(address(wmon));
        assertEq(p, 0.02e18);
        assertEq(t, block.timestamp);

        address unknown = makeAddr("unknown");
        vm.expectRevert(abi.encodeWithSelector(MockOracle.FeedNotSet.selector, unknown));
        oracle.getPriceE18(unknown);

        bytes[] memory none;
        assertEq(oracle.updateFee(none), 0);
        uint256 before = address(this).balance;
        oracle.update{value: 3 wei}(none);
        assertEq(address(this).balance, before, "refunded");
    }

    function test_mockOracle_refundFailure() public {
        bytes[] memory none;
        vm.deal(address(wmon), 1 wei); // a contract with no receive()
        vm.prank(address(wmon));
        vm.expectRevert(MockOracle.RefundFailed.selector);
        oracle.update{value: 1 wei}(none);
    }

    function test_mockRouter_spreadGapAndAdmin() public {
        assertEq(router.quote(address(wmon), address(usdc), 1_000e18), 32_934_000); // $33 − 0.2%

        vm.prank(bob);
        vm.expectRevert(MockRouter.NotAuthorized.selector);
        router.setLiquidityGap(true, 300);

        vm.startPrank(admin);
        router.setOperator(operator);
        vm.expectRevert(MockRouter.BpsTooHigh.selector);
        router.setSpreadBps(5_001);
        router.setSpreadBps(100);
        vm.stopPrank();
        assertEq(router.quote(address(wmon), address(usdc), 1_000e18), 32_670_000);

        vm.prank(operator);
        vm.expectRevert(MockRouter.BpsTooHigh.selector);
        router.setLiquidityGap(true, 4_901);
        vm.prank(operator);
        router.setLiquidityGap(true, 400);
        assertEq(router.quote(address(wmon), address(usdc), 1_000e18), 31_350_000); // −5%

        // In a gap the router ignores minOut on purpose (FloorOrders' check is the guard).
        vm.startPrank(alice);
        wmon.approve(address(router), 1_000e18);
        uint256 out = router.swap(address(wmon), address(usdc), 1_000e18, 33e6, alice);
        vm.stopPrank();
        assertEq(out, 31_350_000);

        uint256 routerUsdc = usdc.balanceOf(address(router));
        vm.prank(admin);
        router.withdraw(IERC20(address(usdc)), admin, routerUsdc);
        assertEq(usdc.balanceOf(admin), routerUsdc);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        router.withdraw(IERC20(address(usdc)), bob, 1);
    }

    receive() external payable {}
}
