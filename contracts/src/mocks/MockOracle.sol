// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IFloorOracle} from "../interfaces/IFloorOracle.sol";

/// @title MockOracle (demo mode, testnet only)
/// @notice Owner- or operator-set USD prices. By default a price reads as published "now",
/// so demo orders never go stale; tests can pin a publish time to exercise staleness checks.
contract MockOracle is IFloorOracle, Ownable2Step {
    struct Feed {
        uint128 price; // 1e18-scaled USD
        uint128 conf; // 1e18-scaled
        uint64 publishTime; // 0 = "live" (reads as block.timestamp)
    }

    mapping(address token => Feed) public feeds;
    /// @notice Extra account allowed to move prices (the /demo panel's server key).
    address public operator;

    event PriceSet(address indexed token, uint256 price, uint256 conf, uint256 publishTime);
    event OperatorSet(address indexed operator);

    error NotAuthorized();
    error InvalidPrice();
    error FeedNotSet(address token);
    error RefundFailed();

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyOwnerOrOperator() {
        if (msg.sender != owner() && msg.sender != operator) revert NotAuthorized();
        _;
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function setPrice(address token, uint256 priceE18) external onlyOwnerOrOperator {
        _set(token, priceE18, 0, 0);
    }

    /// @notice Full control for tests: confidence interval and a fixed publish time.
    function setPriceWithMeta(address token, uint256 priceE18, uint256 confE18, uint64 publishTime)
        external
        onlyOwnerOrOperator
    {
        _set(token, priceE18, confE18, publishTime);
    }

    function _set(address token, uint256 price, uint256 conf, uint64 publishTime) internal {
        if (price == 0 || price > type(uint128).max || conf > type(uint128).max) {
            revert InvalidPrice();
        }
        // Both values were bounds-checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        feeds[token] = Feed({price: uint128(price), conf: uint128(conf), publishTime: publishTime});
        emit PriceSet(token, price, conf, publishTime == 0 ? block.timestamp : publishTime);
    }

    /// @inheritdoc IFloorOracle
    function update(bytes[] calldata) external payable {
        if (msg.value > 0) {
            (bool ok,) = msg.sender.call{value: msg.value}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @inheritdoc IFloorOracle
    function updateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }

    /// @inheritdoc IFloorOracle
    function getPriceE18(address token)
        external
        view
        returns (uint256 price, uint256 conf, uint256 publishTime)
    {
        Feed memory f = feeds[token];
        if (f.price == 0) revert FeedNotSet(token);
        return (f.price, f.conf, f.publishTime == 0 ? block.timestamp : f.publishTime);
    }
}
