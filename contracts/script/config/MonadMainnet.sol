// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title MonadMainnet
/// @notice Third-party addresses and Pyth feed ids for live mode. Every value is copied from
/// docs/addresses.md, which links the official source for each one. packages/shared has the
/// same values for the keeper and app; a vitest test fails if the two ever drift apart.
library MonadMainnet {
    uint256 internal constant CHAIN_ID = 143;

    // Pyth PriceFeed: github.com/monad-crypto/protocols mainnet/pyth.jsonc
    address internal constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    // 0x AllowanceHolder (Cancun+ chains incl. Monad): docs.0x.org 0x cheat sheet
    address internal constant ZEROX_ALLOWANCE_HOLDER = 0x0000000000001fF3684f28c67538d4D072C22734;

    // Tokens: github.com/monad-crypto/token-list tokenlist-mainnet.json
    address internal constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address internal constant WETH = 0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242;
    address internal constant CBBTC = 0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b;
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    // Pyth feed ids (sponsored push feeds on Monad): mainnet/pyth.jsonc
    bytes32 internal constant MON_USD =
        0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    bytes32 internal constant ETH_USD =
        0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 internal constant CBBTC_USD =
        0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97;
    bytes32 internal constant USDC_USD =
        0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;
}
