// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {FloorOrders} from "../src/FloorOrders.sol";
import {PythAdapter} from "../src/oracles/PythAdapter.sol";
import {MonadMainnet as M} from "./config/MonadMainnet.sol";
import {DeploymentIO} from "./DeploymentIO.sol";

/// @title DeployLive
/// @notice Live mode (Monad mainnet 143): PythAdapter on the real Pyth contract, FloorOrders
/// with WMON/WETH/cbBTC -> USDC allowlisted, 0x AllowanceHolder as the only venue, and a
/// per-order USD cap because the contracts are unaudited.
///
/// Env: DEPLOYER_PRIVATE_KEY (required) · EXECUTOR_FEE_BPS (default 10) ·
/// MAX_ORDER_USD (whole dollars, default 500) · PUSH_MAX_ORACLE_AGE (seconds, default 3900:
/// sponsored push feeds have a 1 h heartbeat, D-004; set 0 to keep the 15 s default when the
/// keeper always brings Hermes updates). Writes deployments/143.json (or DEPLOYMENTS_FILE).
contract DeployLive is Script {
    struct Live {
        FloorOrders floor;
        PythAdapter adapter;
    }

    error WrongChain(uint256 chainId);

    function run() external returns (Live memory l) {
        if (block.chainid != M.CHAIN_ID) revert WrongChain(block.chainid);
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint16 fee = uint16(vm.envOr("EXECUTOR_FEE_BPS", uint256(10)));
        uint256 capUsd = vm.envOr("MAX_ORDER_USD", uint256(500));
        uint32 pushAge = uint32(vm.envOr("PUSH_MAX_ORACLE_AGE", uint256(3_900)));

        vm.startBroadcast(pk);
        l = deploy(deployer, fee, capUsd, pushAge);
        vm.stopBroadcast();

        _logPrices(l.adapter);
        _write(l, deployer);
    }

    /// @notice `owner` must be the caller (see DeployDemo.deploy).
    function deploy(address owner, uint16 fee, uint256 capUsd, uint32 pushAge)
        public
        returns (Live memory l)
    {
        l.adapter = new PythAdapter(owner, IPyth(M.PYTH));
        l.adapter.setFeed(M.WMON, M.MON_USD);
        l.adapter.setFeed(M.WETH, M.ETH_USD);
        l.adapter.setFeed(M.CBBTC, M.CBBTC_USD);
        l.adapter.setFeed(M.USDC, M.USDC_USD);

        l.floor = new FloorOrders(owner, l.adapter, fee);
        address[4] memory tokens = [M.WMON, M.WETH, M.CBBTC, M.USDC];
        for (uint256 i; i < tokens.length; ++i) {
            l.floor.setTokenAllowed(tokens[i], true);
            if (pushAge != 0) l.floor.setTokenMaxOracleAge(tokens[i], pushAge);
        }
        // AllowanceHolder is both the call target and the spender (D-003).
        l.floor.setSwapTarget(M.ZEROX_ALLOWANCE_HOLDER, M.ZEROX_ALLOWANCE_HOLDER, true);
        l.floor.setMaxOrderUsdE18(capUsd * 1e18);
    }

    /// @dev Sanity check only: prints what Pyth currently has for each feed.
    function _logPrices(PythAdapter adapter) internal view {
        address[4] memory tokens = [M.WMON, M.WETH, M.CBBTC, M.USDC];
        string[4] memory names = ["WMON", "WETH", "cbBTC", "USDC"];
        for (uint256 i; i < tokens.length; ++i) {
            try adapter.getPriceE18(tokens[i]) returns (uint256 p, uint256 c, uint256 t) {
                console2.log(names[i], "price e18:", p);
                console2.log(
                    "   conf e18:", c, "age s:", block.timestamp > t ? block.timestamp - t : 0
                );
            } catch {
                console2.log(names[i], "price: UNAVAILABLE (check the feed id)");
            }
        }
    }

    function _write(Live memory l, address owner) internal {
        string memory t = "tokens";
        vm.serializeAddress(t, "WMON", M.WMON);
        vm.serializeAddress(t, "WETH", M.WETH);
        vm.serializeAddress(t, "cbBTC", M.CBBTC);
        string memory tokens = vm.serializeAddress(t, "USDC", M.USDC);

        string memory k = "deployment";
        vm.serializeString(k, "mode", "live");
        vm.serializeUint(k, "chainId", block.chainid);
        // Block the deploy started from: contracts exist at or after it (a lower bound for log scans).
        vm.serializeUint(k, "startBlock", block.number);
        vm.serializeAddress(k, "owner", owner);
        vm.serializeAddress(k, "floorOrders", address(l.floor));
        vm.serializeAddress(k, "oracle", address(l.adapter));
        vm.serializeAddress(k, "pyth", M.PYTH);
        vm.serializeAddress(k, "swapTarget", M.ZEROX_ALLOWANCE_HOLDER);
        vm.serializeAddress(k, "swapSpender", M.ZEROX_ALLOWANCE_HOLDER);
        string memory json = vm.serializeString(k, "tokens", tokens);

        string memory file = DeploymentIO.path();
        vm.writeJson(json, file);
        console2.log("FloorOrders:", address(l.floor));
        console2.log("PythAdapter:", address(l.adapter));
        console2.log("written to: ", file);
    }
}
