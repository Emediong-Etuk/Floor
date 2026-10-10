// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {FloorOrders} from "../src/FloorOrders.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {DeploymentIO} from "./DeploymentIO.sol";

/// @title DeployDemo
/// @notice Demo mode (Monad testnet 10143, or a local anvil 31337): MockOracle with seeded
/// prices, faucet tokens, a funded MockRouter and FloorOrders wired to them.
///
/// Env: DEPLOYER_PRIVATE_KEY (required) · DEMO_OPERATOR_ADDRESS (optional: the /demo panel's
/// server key, allowed to move prices and toggle the liquidity gap) · EXECUTOR_FEE_BPS (default 10).
/// Writes deployments/<chainId>.json.
contract DeployDemo is Script {
    struct Demo {
        FloorOrders floor;
        MockOracle oracle;
        MockRouter router;
        MockERC20 wmon;
        MockERC20 weth;
        MockERC20 cbbtc;
        MockERC20 usdc;
    }

    uint16 internal constant DEFAULT_FEE_BPS = 10; // 0.1%, the business model in the pitch

    // Seed prices: rounded from mainnet Pyth on 2026-10-10 (MON $0.0248, ETH $2,494,
    // cbBTC $82,845). Demo values only; the /demo panel moves them.
    uint256 internal constant MON_PRICE = 0.025e18;
    uint256 internal constant ETH_PRICE = 2_500e18;
    uint256 internal constant BTC_PRICE = 83_000e18;
    uint256 internal constant USDC_PRICE = 1e18;

    error WrongChain(uint256 chainId);

    function run() external returns (Demo memory d) {
        if (block.chainid != 10_143 && block.chainid != 31_337) revert WrongChain(block.chainid);
        uint256 pk = DeploymentIO.privateKey("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address operator = vm.envOr("DEMO_OPERATOR_ADDRESS", address(0));
        uint16 fee = uint16(vm.envOr("EXECUTOR_FEE_BPS", uint256(DEFAULT_FEE_BPS)));

        vm.startBroadcast(pk);
        d = deploy(deployer, operator, fee);
        vm.stopBroadcast();

        _write(d, deployer, operator);
    }

    /// @notice Deploys and wires everything. `owner` must be the caller (the broadcaster in
    /// `run`, or the script contract itself in tests), since it makes the admin calls.
    function deploy(address owner, address operator, uint16 fee) public returns (Demo memory d) {
        // Faucet caps per call at seed prices: about $250 MON, $2.5k ETH, $830 BTC, $1k USDC.
        d.wmon = new MockERC20("Floor Demo WMON", "WMON", 18, 10_000e18);
        d.weth = new MockERC20("Floor Demo WETH", "WETH", 18, 1e18);
        d.cbbtc = new MockERC20("Floor Demo cbBTC", "cbBTC", 8, 0.01e8);
        d.usdc = new MockERC20("Floor Demo USDC", "USDC", 6, 1_000e6);

        d.oracle = new MockOracle(owner);
        d.oracle.setPrice(address(d.wmon), MON_PRICE);
        d.oracle.setPrice(address(d.weth), ETH_PRICE);
        d.oracle.setPrice(address(d.cbbtc), BTC_PRICE);
        d.oracle.setPrice(address(d.usdc), USDC_PRICE);

        // Router liquidity: plenty of every token, so demo sells (and reverse tests) never run dry.
        d.router = new MockRouter(owner, d.oracle);
        d.usdc.mint(address(d.router), 100_000_000e6);
        d.wmon.mint(address(d.router), 1_000_000_000e18);
        d.weth.mint(address(d.router), 100_000e18);
        d.cbbtc.mint(address(d.router), 1_000e8);

        d.floor = new FloorOrders(owner, d.oracle, fee);
        d.floor.setTokenAllowed(address(d.wmon), true);
        d.floor.setTokenAllowed(address(d.weth), true);
        d.floor.setTokenAllowed(address(d.cbbtc), true);
        d.floor.setTokenAllowed(address(d.usdc), true);
        d.floor.setSwapTarget(address(d.router), address(d.router), true);

        if (operator != address(0)) {
            d.oracle.setOperator(operator);
            d.router.setOperator(operator);
        }
    }

    function _write(Demo memory d, address owner, address operator) internal {
        string memory t = "tokens";
        vm.serializeAddress(t, "WMON", address(d.wmon));
        vm.serializeAddress(t, "WETH", address(d.weth));
        vm.serializeAddress(t, "cbBTC", address(d.cbbtc));
        string memory tokens = vm.serializeAddress(t, "USDC", address(d.usdc));

        string memory k = "deployment";
        vm.serializeString(k, "mode", "demo");
        vm.serializeUint(k, "chainId", block.chainid);
        // Block the deploy started from: contracts exist at or after it (a lower bound for log scans).
        vm.serializeUint(k, "startBlock", block.number);
        vm.serializeAddress(k, "owner", owner);
        vm.serializeAddress(k, "operator", operator);
        vm.serializeAddress(k, "floorOrders", address(d.floor));
        vm.serializeAddress(k, "oracle", address(d.oracle));
        vm.serializeAddress(k, "swapTarget", address(d.router));
        vm.serializeAddress(k, "swapSpender", address(d.router));
        string memory json = vm.serializeString(k, "tokens", tokens);

        string memory file = DeploymentIO.path();
        vm.writeJson(json, file);
        console2.log("FloorOrders:", address(d.floor));
        console2.log("MockOracle: ", address(d.oracle));
        console2.log("MockRouter: ", address(d.router));
        console2.log("written to: ", file);
    }
}
