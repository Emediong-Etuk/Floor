// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FloorMath
/// @notice Price conversion shared by FloorOrders and MockRouter. The keeper and app mirror
/// this exactly in TypeScript (packages/shared), checked against shared test vectors.
library FloorMath {
    uint256 internal constant BPS = 10_000;

    /// @notice How much tokenOut `amountIn` of tokenIn is worth at the given USD prices.
    /// @dev amountIn * pIn / pOut, rescaled from decIn to decOut decimals. Math.mulDiv keeps
    /// full 512-bit precision for the intermediate product, so a*b can't overflow.
    /// Callers guarantee decimals <= 18, amountIn <= uint128 and prices in (0, uint128].
    function convert(uint256 amountIn, uint8 decIn, uint8 decOut, uint256 pIn, uint256 pOut)
        internal
        pure
        returns (uint256)
    {
        if (decOut >= decIn) return Math.mulDiv(amountIn * 10 ** (decOut - decIn), pIn, pOut);
        return Math.mulDiv(amountIn, pIn, pOut * 10 ** (decIn - decOut));
    }

    /// @notice `amount` reduced by `bps` basis points, rounded down.
    function lessBps(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(amount, BPS - bps, BPS);
    }

    /// @notice Oracle-implied output minus the allowed slippage: the least a fill may return.
    function minOut(
        uint256 amountIn,
        uint8 decIn,
        uint8 decOut,
        uint256 pIn,
        uint256 pOut,
        uint256 slippageBps
    ) internal pure returns (uint256) {
        return lessBps(convert(amountIn, decIn, decOut, pIn, pOut), slippageBps);
    }
}
