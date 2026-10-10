// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IFloorOracle
/// @notice The price source FloorOrders reads. PythAdapter implements it on mainnet,
/// MockOracle in demo mode. All prices are USD per 1 whole token, scaled to 1e18.
interface IFloorOracle {
    /// @notice Pull-oracle update (Pyth). An empty array is a no-op (sponsored push feeds
    /// keep prices fresh; see docs/DECISIONS.md D-004). Must refund unused msg.value to the caller.
    function update(bytes[] calldata updateData) external payable;

    /// @notice Native fee `update(updateData)` needs. 0 for an empty array.
    function updateFee(bytes[] calldata updateData) external view returns (uint256);

    /// @notice Latest cached price. No freshness check here: the caller decides what is fresh.
    /// @return price USD price of 1 whole token, 1e18-scaled, always > 0
    /// @return conf confidence interval, same scale
    /// @return publishTime unix time the price was published
    function getPriceE18(address token)
        external
        view
        returns (uint256 price, uint256 conf, uint256 publishTime);
}
