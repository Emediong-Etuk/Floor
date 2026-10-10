// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20 (demo mode, testnet only)
/// @notice Test token with configurable decimals and a public, per-call-capped faucet mint.
/// The deployer (minter) can mint any amount, e.g. to fund MockRouter.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable mintCap;
    address public immutable minter;

    error MintCapExceeded(uint256 requested, uint256 cap);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 mintCap_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
        mintCap = mintCap_;
        minter = msg.sender;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Faucet: anyone can mint up to `mintCap` per call.
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter && amount > mintCap) revert MintCapExceeded(amount, mintCap);
        _mint(to, amount);
    }
}
