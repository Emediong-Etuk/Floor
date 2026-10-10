// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IFloorOracle} from "../interfaces/IFloorOracle.sol";
import {FloorMath} from "../libraries/FloorMath.sol";

/// @title MockRouter (demo mode, testnet only)
/// @notice Swaps at the MockOracle price minus a small spread, paying from its pre-funded
/// balance. A "liquidity gap" switch makes it pay well below the oracle price, so the demo can
/// show FloorOrders refusing a bad fill.
contract MockRouter is Ownable2Step {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_BPS = 5_000;

    IFloorOracle public immutable oracle;
    uint16 public spreadBps = 20; // 0.2%
    bool public liquidityGap;
    uint16 public gapBps = 300; // extra 3% shortfall while the gap is on
    address public operator;

    event Swapped(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );
    event SpreadSet(uint16 spreadBps);
    event LiquidityGapSet(bool on, uint16 gapBps);
    event OperatorSet(address indexed operator);

    error NotAuthorized();
    error BpsTooHigh();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    constructor(address owner_, IFloorOracle oracle_) Ownable(owner_) {
        oracle = oracle_;
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function setSpreadBps(uint16 spreadBps_) external onlyOwner {
        if (spreadBps_ > MAX_BPS) revert BpsTooHigh();
        spreadBps = spreadBps_;
        emit SpreadSet(spreadBps_);
    }

    /// @notice Owner or the demo panel's operator key can open/close the liquidity gap.
    function setLiquidityGap(bool on, uint16 gapBps_) external {
        if (msg.sender != owner() && msg.sender != operator) revert NotAuthorized();
        if (gapBps_ + spreadBps > MAX_BPS) revert BpsTooHigh();
        liquidityGap = on;
        gapBps = gapBps_;
        emit LiquidityGapSet(on, gapBps_);
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        public
        view
        returns (uint256)
    {
        (uint256 pIn,,) = oracle.getPriceE18(tokenIn);
        (uint256 pOut,,) = oracle.getPriceE18(tokenOut);
        uint256 out = FloorMath.convert(
            amountIn,
            IERC20Metadata(tokenIn).decimals(),
            IERC20Metadata(tokenOut).decimals(),
            pIn,
            pOut
        );
        return FloorMath.lessBps(out, liquidityGap ? spreadBps + gapBps : spreadBps);
    }

    /// @notice Pulls `amountIn` from the caller and pays `tokenOut` to `recipient`.
    /// @dev Enforces `minOut` itself, except during a liquidity gap: then it pays short on
    /// purpose so the caller's own minimum-output check is what stops the trade.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external returns (uint256 amountOut) {
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (!liquidityGap && amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, recipient);
    }

    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }
}
