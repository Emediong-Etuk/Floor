// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IFloorOracle} from "../interfaces/IFloorOracle.sol";

/// @title PythAdapter
/// @notice Maps tokens to Pyth feed ids and converts Pyth prices to 1e18 fixed point.
/// @dev Pyth is a pull oracle: anyone can post a signed price update (from Hermes) and pay a
/// small fee. On Monad mainnet Pyth also pushes sponsored updates for our feeds, so `update`
/// accepts an empty array (D-004). Pyth pull updates: https://docs.pyth.network/price-feeds/pull-updates
contract PythAdapter is IFloorOracle, Ownable2Step {
    IPyth public immutable pyth;

    /// @notice token => Pyth feed id (e.g. WMON => MON/USD)
    mapping(address token => bytes32 feedId) public feedIds;

    event FeedSet(address indexed token, bytes32 indexed feedId);

    error ZeroAddress();
    error FeedNotSet(address token);
    error InvalidPrice(int64 price);
    error InvalidExpo(int32 expo);
    error InsufficientFee(uint256 required, uint256 provided);
    error RefundFailed();

    constructor(address owner_, IPyth pyth_) Ownable(owner_) {
        if (address(pyth_) == address(0)) revert ZeroAddress();
        pyth = pyth_;
    }

    function setFeed(address token, bytes32 feedId) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        feedIds[token] = feedId;
        emit FeedSet(token, feedId);
    }

    /// @inheritdoc IFloorOracle
    function update(bytes[] calldata updateData) external payable {
        uint256 fee;
        if (updateData.length > 0) {
            fee = pyth.getUpdateFee(updateData);
            if (msg.value < fee) revert InsufficientFee(fee, msg.value);
            // Pay exactly the fee: Pyth keeps any overpayment.
            pyth.updatePriceFeeds{value: fee}(updateData);
        }
        uint256 refund = msg.value - fee;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @inheritdoc IFloorOracle
    function updateFee(bytes[] calldata updateData) external view returns (uint256) {
        return updateData.length == 0 ? 0 : pyth.getUpdateFee(updateData);
    }

    /// @inheritdoc IFloorOracle
    function getPriceE18(address token)
        external
        view
        returns (uint256 price, uint256 conf, uint256 publishTime)
    {
        bytes32 id = feedIds[token];
        if (id == bytes32(0)) revert FeedNotSet(token);
        // "Unsafe" = no recency check; FloorOrders applies its own per-token max age.
        PythStructs.Price memory p = pyth.getPriceUnsafe(id);
        if (p.price <= 0) revert InvalidPrice(p.price);
        // p.price > 0 was just checked, so the int64 -> uint64 cast is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        price = toE18(uint256(uint64(p.price)), p.expo);
        conf = toE18(p.conf, p.expo);
        publishTime = p.publishTime;
    }

    /// @notice Converts `value * 10^expo` to `value * 10^18`. Pyth expos are small negatives
    /// (e.g. -8). We bound expo so 10**x never overflows and int64 * 10**x fits in uint256.
    function toE18(uint256 value, int32 expo) public pure returns (uint256) {
        if (expo < -58 || expo > 18) revert InvalidExpo(expo);
        int256 shift = int256(expo) + 18;
        // shift is in [-40, 36] after the bounds check, so both casts are exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (shift >= 0) return value * 10 ** uint256(shift);
        // forge-lint: disable-next-line(unsafe-typecast)
        return value / 10 ** uint256(-shift);
    }
}
