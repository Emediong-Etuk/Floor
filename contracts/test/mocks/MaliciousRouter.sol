// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FloorOrders} from "../../src/FloorOrders.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";

/// @notice An allowlisted venue that turns hostile. Each mode tries a different attack from
/// inside FloorOrders.execute; every one must fail or leave the user no worse than minOut.
contract MaliciousRouter {
    enum Mode {
        REENTER_EXECUTE, // re-enter execute() on another order
        REENTER_CANCEL, // re-enter cancelOrder()
        PAY_SHORT, // pull the tokens, pay half the fair amount
        STEAL_VICTIM, // use FloorOrders' context to move a third party's approved tokens
        PULL_EXTRA, // try to pull more than the approved amountIn
        PARTIAL_PULL, // take only half the input but pay minOut (FloorOrders must refund the rest)
        HONEST // behave: swap through the real MockRouter at fair price
    }

    Mode public mode;
    FloorOrders public immutable floor;
    MockRouter public immutable inner;
    uint256 public targetId;
    address public victim;

    constructor(FloorOrders floor_, MockRouter inner_) {
        floor = floor_;
        inner = inner_;
    }

    function configure(Mode mode_, uint256 targetId_, address victim_) external {
        mode = mode_;
        targetId = targetId_;
        victim = victim_;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address)
        external
        returns (uint256)
    {
        if (mode == Mode.REENTER_EXECUTE) {
            bytes[] memory none;
            floor.execute(
                targetId, none, FloorOrders.SwapData(address(this), address(this), msg.data)
            );
        } else if (mode == Mode.REENTER_CANCEL) {
            floor.cancelOrder(targetId);
        } else if (mode == Mode.PAY_SHORT) {
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
            IERC20(tokenOut).transfer(msg.sender, minOut / 2);
            return minOut / 2;
        } else if (mode == Mode.STEAL_VICTIM) {
            // The victim approved FloorOrders, not this router, so this must revert.
            IERC20(tokenIn).transferFrom(victim, address(this), amountIn);
        } else if (mode == Mode.PULL_EXTRA) {
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn + 1);
        } else if (mode == Mode.PARTIAL_PULL) {
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn / 2);
            IERC20(tokenOut).transfer(msg.sender, minOut);
            return minOut;
        }
        // HONEST (and fall-through): fair swap via the real mock router.
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(address(inner), amountIn);
        return inner.swap(tokenIn, tokenOut, amountIn, minOut, msg.sender);
    }
}
