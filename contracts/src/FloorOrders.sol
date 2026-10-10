// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IFloorOracle} from "./interfaces/IFloorOracle.sol";
import {FloorMath} from "./libraries/FloorMath.sol";

/// @title FloorOrders
/// @notice Non-custodial stop-loss and take-profit orders. A user approves this contract for
/// the exact amount and creates an order; their tokens stay in their wallet. When the oracle
/// price crosses the trigger, anyone can call `execute`. The contract re-checks the trigger,
/// pulls the tokens, sells them through an allowlisted venue and requires an oracle-derived
/// minimum output, so an executor can never fire early or sell below the user's limit.
/// @dev Not audited. Hackathon software. Security rules: build prompt §6.6.
contract FloorOrders is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum Kind {
        STOP_LOSS,
        TAKE_PROFIT
    }

    enum Status {
        NONE,
        ACTIVE,
        FILLED,
        CANCELLED,
        EXPIRED
    }

    struct Order {
        address owner;
        address tokenIn; // token being protected (ERC-20; native MON must be wrapped to WMON)
        address tokenOut; // USDC in the MVP
        uint128 amountIn;
        uint128 triggerPriceE18; // USD price of tokenIn that fires the order
        uint128 limitPriceE18; // STOP_LOSS only: "never sell below" (0 = none)
        uint16 maxSlippageBps; // vs oracle-implied output (cap MAX_SLIPPAGE_BPS)
        Kind kind;
        Status status;
        uint64 expiry; // 0 = never
        uint64 createdAt;
        uint64 linkedOrderId; // OCO sibling (0 = none)
        uint128 amountOut; // set on fill, net of executor fee
        uint64 filledAt;
        uint128 fillPriceE18; // oracle price of tokenIn at fill
    }

    struct CreateParams {
        address tokenIn;
        address tokenOut;
        uint128 amountIn;
        uint128 triggerPriceE18;
        uint128 limitPriceE18;
        uint16 maxSlippageBps;
        Kind kind;
        uint64 expiry;
    }

    /// @notice How the executor wants the tokens sold. `target` is called with `data` after
    /// `spender` is approved for exactly `amountIn`. The (target, spender) pair must be allowlisted.
    struct SwapData {
        address target;
        address spender;
        bytes data;
    }

    // ------------------------------------------------------------------ constants

    uint16 public constant MAX_SLIPPAGE_BPS = 500; // 5%
    uint16 public constant MAX_EXECUTOR_FEE_BPS = 50; // 0.5%
    uint8 public constant MAX_TOKEN_DECIMALS = 18;

    // ------------------------------------------------------------------ config

    IFloorOracle public oracle;
    uint16 public executorFeeBps;
    /// @notice Default max oracle age in seconds (D-004: overridable per token).
    uint32 public maxOracleAge = 15;
    /// @notice Per-token max oracle age; 0 = use `maxOracleAge`.
    mapping(address token => uint32 age) public tokenMaxOracleAge;
    /// @notice Max confidence interval as a share of price, in bps.
    uint16 public maxConfBps = 100;
    /// @notice Max USD value of a new order (1e18-scaled); 0 = no cap.
    uint256 public maxOrderUsdE18;

    mapping(address token => bool) public tokenAllowed;
    /// @notice Decimals cached when a token is allowlisted (saves a call per execute).
    mapping(address token => uint8) public tokenDecimals;
    /// @notice target => spender => allowed. The core defence: executors can only make this
    /// contract call vetted venues, never e.g. `token.transferFrom(victim, attacker, ...)`.
    mapping(address target => mapping(address spender => bool)) public swapTargetAllowed;
    /// @notice Number of allowlisted pairs an address appears in (as target or spender).
    /// Lets `setTokenAllowed` refuse to allowlist a venue address as a token.
    mapping(address => uint256) public venueRefCount;

    // ------------------------------------------------------------------ storage

    uint64 public nextOrderId = 1; // ids start at 1 so linkedOrderId 0 means "none"
    mapping(uint256 id => Order) internal _orders;
    mapping(address owner => uint256[] ids) internal _ownerOrders;
    uint256[] internal _activeIds;
    mapping(uint256 id => uint256 indexPlusOne) internal _activeIndex;

    // ------------------------------------------------------------------ events

    event OrderCreated(
        uint256 indexed id,
        address indexed owner,
        Kind kind,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 triggerPriceE18,
        uint256 limitPriceE18,
        uint16 maxSlippageBps,
        uint64 expiry
    );
    event BracketCreated(
        uint256 indexed stopId, uint256 indexed takeProfitId, address indexed owner
    );
    event OrderUpdated(
        uint256 indexed id,
        uint256 triggerPriceE18,
        uint256 limitPriceE18,
        uint16 maxSlippageBps,
        uint64 expiry
    );
    event OrderCancelled(uint256 indexed id, address indexed owner);
    event OrderExpired(uint256 indexed id, address indexed owner);
    event OrderFilled(
        uint256 indexed id,
        address indexed owner,
        address indexed executor,
        uint256 priceE18,
        uint256 amountIn,
        uint256 amountOut,
        uint256 executorFee
    );

    event OracleSet(address indexed oracle);
    event TokenAllowedSet(address indexed token, bool allowed, uint8 decimals);
    event SwapTargetSet(address indexed target, address indexed spender, bool allowed);
    event ExecutorFeeSet(uint16 bps);
    event MaxOracleAgeSet(uint32 seconds_);
    event TokenMaxOracleAgeSet(address indexed token, uint32 seconds_);
    event MaxConfBpsSet(uint16 bps);
    event MaxOrderUsdSet(uint256 usdE18);

    // ------------------------------------------------------------------ errors

    error ZeroAddress();
    error ZeroAmount();
    error TokenNotAllowed(address token);
    error SameToken();
    error InvalidTriggerPrice();
    error InvalidLimitPrice();
    error InvalidBracketPrices();
    error SlippageTooHigh(uint16 bps);
    error FeeTooHigh(uint16 bps);
    error InvalidConfBps();
    error InvalidExpiry();
    error UnsupportedDecimals(uint8 decimals);
    error OrderTooLarge(uint256 usdE18, uint256 capE18);
    error NotOrderOwner();
    error NotActive(uint256 id);
    error Expired(uint256 id);
    error NotExpired(uint256 id);
    error NotTriggered(uint256 priceE18, uint256 triggerPriceE18);
    error StalePrice(address token, uint256 publishTime);
    error PriceTooUncertain(address token, uint256 conf, uint256 price);
    error InvalidOraclePrice(address token);
    error SwapTargetNotAllowed(address target, address spender);
    error InvalidSwapTarget(address target);
    error InsufficientBalanceOrAllowance(uint256 balance, uint256 allowance, uint256 required);
    error InsufficientFee(uint256 required, uint256 provided);
    error InsufficientOutput(uint256 received, uint256 minOut);
    error SwapFailed();
    error RefundFailed();

    // ------------------------------------------------------------------ constructor

    constructor(address owner_, IFloorOracle oracle_, uint16 executorFeeBps_) Ownable(owner_) {
        _setOracle(oracle_);
        _setExecutorFeeBps(executorFeeBps_);
    }

    // ================================================================== user

    /// @notice Create one stop-loss or take-profit order. Approve this contract for at least
    /// `p.amountIn` of `p.tokenIn` first (the app approves exactly what's needed).
    function createOrder(CreateParams calldata p)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        _validateNew(p.tokenIn, p.tokenOut, p.amountIn, p.maxSlippageBps, p.expiry);
        _validatePrices(p.kind, p.triggerPriceE18, p.limitPriceE18);
        id = _store(
            p.tokenIn,
            p.tokenOut,
            p.amountIn,
            p.triggerPriceE18,
            p.limitPriceE18,
            p.maxSlippageBps,
            p.kind,
            p.expiry
        );
    }

    /// @notice Create a floor (stop-loss) and a cash-out (take-profit) for the same tokens,
    /// linked one-cancels-other: when one fills, the other is cancelled in the same tx.
    /// Needs an allowance of `amountIn` (not 2x): only one leg can ever fill.
    function createBracket(
        address tokenIn,
        address tokenOut,
        uint128 amountIn,
        uint128 stopPriceE18,
        uint128 takeProfitPriceE18,
        uint128 limitPriceE18,
        uint16 maxSlippageBps,
        uint64 expiry
    ) external nonReentrant whenNotPaused returns (uint256 stopId, uint256 takeProfitId) {
        _validateNew(tokenIn, tokenOut, amountIn, maxSlippageBps, expiry);
        _validatePrices(Kind.STOP_LOSS, stopPriceE18, limitPriceE18);
        if (takeProfitPriceE18 <= stopPriceE18) revert InvalidBracketPrices();

        stopId = _store(
            tokenIn,
            tokenOut,
            amountIn,
            stopPriceE18,
            limitPriceE18,
            maxSlippageBps,
            Kind.STOP_LOSS,
            expiry
        );
        takeProfitId = _store(
            tokenIn,
            tokenOut,
            amountIn,
            takeProfitPriceE18,
            0,
            maxSlippageBps,
            Kind.TAKE_PROFIT,
            expiry
        );
        // Ids come from the uint64 counter `nextOrderId`, so they always fit.
        // forge-lint: disable-next-line(unsafe-typecast)
        _orders[stopId].linkedOrderId = uint64(takeProfitId);
        // forge-lint: disable-next-line(unsafe-typecast)
        _orders[takeProfitId].linkedOrderId = uint64(stopId);
        emit BracketCreated(stopId, takeProfitId, msg.sender);
    }

    /// @notice Move an active order's trigger, stop-limit, slippage or expiry.
    function updateOrder(
        uint256 id,
        uint128 newTriggerPriceE18,
        uint128 newLimitPriceE18,
        uint16 newMaxSlippageBps,
        uint64 newExpiry
    ) external nonReentrant whenNotPaused {
        Order storage o = _ownedActive(id);
        if (newMaxSlippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(newMaxSlippageBps);
        if (newExpiry != 0 && newExpiry <= block.timestamp) revert InvalidExpiry();
        _validatePrices(o.kind, newTriggerPriceE18, newLimitPriceE18);
        // Keep a bracket coherent: the floor must stay below the cash-out price.
        if (o.linkedOrderId != 0) {
            Order storage s = _orders[o.linkedOrderId];
            if (s.status == Status.ACTIVE) {
                bool ok = o.kind == Kind.STOP_LOSS
                    ? newTriggerPriceE18 < s.triggerPriceE18
                    : newTriggerPriceE18 > s.triggerPriceE18;
                if (!ok) revert InvalidBracketPrices();
            }
        }
        o.triggerPriceE18 = newTriggerPriceE18;
        o.limitPriceE18 = newLimitPriceE18;
        o.maxSlippageBps = newMaxSlippageBps;
        o.expiry = newExpiry;
        emit OrderUpdated(id, newTriggerPriceE18, newLimitPriceE18, newMaxSlippageBps, newExpiry);
    }

    /// @notice Cancel an active order (and its bracket sibling). Works while paused, so users
    /// can always back out.
    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = _ownedActive(id);
        _close(id, o, Status.CANCELLED);
        emit OrderCancelled(id, o.owner);
        _cancelSibling(o);
    }

    // ================================================================== executor

    /// @notice Fill a triggered order. Callable by anyone; the executor earns `executorFeeBps`
    /// of the output. Send `msg.value >= updateFee(priceUpdate)`; the rest is refunded.
    /// @param priceUpdate Pyth update bytes from Hermes, or empty to use the cached
    /// (sponsored-push) price.
    /// @param swap Venue call that sells `amountIn` of tokenIn for tokenOut, paying this contract.
    function execute(uint256 id, bytes[] calldata priceUpdate, SwapData calldata swap)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        // 1. Load and check status / expiry.
        Order storage o = _orders[id];
        if (o.status != Status.ACTIVE) revert NotActive(id);
        if (_isExpired(o)) revert Expired(id);
        if (!tokenAllowed[o.tokenIn]) revert TokenNotAllowed(o.tokenIn);
        if (!tokenAllowed[o.tokenOut]) revert TokenNotAllowed(o.tokenOut);

        // 2. Post the oracle update, paying exactly its fee (Pyth keeps overpayments).
        uint256 updateFee = oracle.updateFee(priceUpdate);
        if (msg.value < updateFee) revert InsufficientFee(updateFee, msg.value);
        oracle.update{value: updateFee}(priceUpdate);

        // 3. Fresh, confident prices for both legs (USDC is priced too, never assumed $1).
        uint256 pIn = _checkedPrice(o.tokenIn);
        uint256 pOut = _checkedPrice(o.tokenOut);

        // 4. Trigger check against the oracle, not the executor's word.
        if (!_triggered(o, pIn)) revert NotTriggered(pIn, o.triggerPriceE18);

        // 5. Least acceptable output, derived from the oracle and the user's slippage.
        uint256 minOut = FloorMath.minOut(
            o.amountIn,
            tokenDecimals[o.tokenIn],
            tokenDecimals[o.tokenOut],
            pIn,
            pOut,
            o.maxSlippageBps
        );

        // 6. Effects before interactions: the order (and its sibling) close now, so a
        //    re-entrant call finds nothing to fill.
        _close(id, o, Status.FILLED);
        _cancelSibling(o);

        // 7. Only vetted venues.
        if (!swapTargetAllowed[swap.target][swap.spender]) {
            revert SwapTargetNotAllowed(swap.target, swap.spender);
        }

        uint256 received = _pullAndSwap(o, swap, minOut);

        // 11. Pay out: executor fee to the caller, the rest to the order owner.
        uint256 fee = received * executorFeeBps / FloorMath.BPS;
        uint256 net = received - fee;
        o.amountOut = SafeCast.toUint128(net);
        // forge-lint: disable-next-line(unsafe-typecast)
        o.filledAt = uint64(block.timestamp);
        // pIn <= uint128.max is checked in _checkedPrice.
        // forge-lint: disable-next-line(unsafe-typecast)
        o.fillPriceE18 = uint128(pIn);
        IERC20 tokenOut = IERC20(o.tokenOut);
        if (fee > 0) tokenOut.safeTransfer(msg.sender, fee);
        tokenOut.safeTransfer(o.owner, net);
        emit OrderFilled(id, o.owner, msg.sender, pIn, o.amountIn, net, fee);

        // Refund whatever native value the oracle didn't need.
        uint256 refund = msg.value - updateFee;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @notice Mark an expired order as EXPIRED and drop it from the active set. Anyone can call.
    function expire(uint256 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.status != Status.ACTIVE) revert NotActive(id);
        if (!_isExpired(o)) revert NotExpired(id);
        _close(id, o, Status.EXPIRED);
        emit OrderExpired(id, o.owner);
    }

    // ================================================================== views

    function getOrder(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    function ownerOrderCount(address owner_) external view returns (uint256) {
        return _ownerOrders[owner_].length;
    }

    /// @notice An owner's orders, newest first. `offset` counts from the newest.
    function getOrdersByOwner(address owner_, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Order[] memory orders)
    {
        uint256[] storage all = _ownerOrders[owner_];
        uint256 n = _pageSize(all.length, offset, limit);
        ids = new uint256[](n);
        orders = new Order[](n);
        for (uint256 i; i < n; ++i) {
            uint256 id = all[all.length - 1 - offset - i];
            ids[i] = id;
            orders[i] = _orders[id];
        }
    }

    function activeOrderCount() external view returns (uint256) {
        return _activeIds.length;
    }

    /// @notice Page through active orders (order of the set is not stable across removals).
    function getActiveOrders(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Order[] memory orders)
    {
        uint256 n = _pageSize(_activeIds.length, offset, limit);
        ids = new uint256[](n);
        orders = new Order[](n);
        for (uint256 i; i < n; ++i) {
            uint256 id = _activeIds[offset + i];
            ids[i] = id;
            orders[i] = _orders[id];
        }
    }

    /// @notice Pre-check for the keeper and UI using the oracle's cached prices. Ignores
    /// freshness and confidence (the keeper may bring a fresh update); `execute` enforces both.
    function checkTrigger(uint256 id)
        external
        view
        returns (bool triggered, uint256 priceE18, uint256 minOut)
    {
        Order storage o = _orders[id];
        // forge-lint: disable-next-line(boolean-cst)
        if (o.status != Status.ACTIVE) return (false, 0, 0);
        (priceE18,,) = oracle.getPriceE18(o.tokenIn);
        (uint256 pOut,,) = oracle.getPriceE18(o.tokenOut);
        triggered = !_isExpired(o) && _triggered(o, priceE18);
        minOut = FloorMath.minOut(
            o.amountIn,
            tokenDecimals[o.tokenIn],
            tokenDecimals[o.tokenOut],
            priceE18,
            pOut,
            o.maxSlippageBps
        );
    }

    /// @notice The minimum output `execute` would require at the given prices.
    function quoteMinOut(uint256 id, uint256 priceInE18, uint256 priceOutE18)
        external
        view
        returns (uint256)
    {
        Order storage o = _orders[id];
        if (o.status == Status.NONE) revert NotActive(id);
        return FloorMath.minOut(
            o.amountIn,
            tokenDecimals[o.tokenIn],
            tokenDecimals[o.tokenOut],
            priceInE18,
            priceOutE18,
            o.maxSlippageBps
        );
    }

    /// @notice Effective max oracle age for `token`.
    function oracleAgeFor(address token) public view returns (uint32) {
        uint32 a = tokenMaxOracleAge[token];
        return a == 0 ? maxOracleAge : a;
    }

    // ================================================================== admin

    function setOracle(IFloorOracle oracle_) external onlyOwner {
        _setOracle(oracle_);
    }

    /// @notice Allowlist a plain ERC-20 (no fee-on-transfer, no rebasing) with <= 18 decimals.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        uint8 dec = tokenDecimals[token];
        if (allowed) {
            // A token must never double as a swap venue (see setSwapTarget).
            if (token == address(this) || venueRefCount[token] > 0) {
                revert InvalidSwapTarget(token);
            }
            dec = IERC20Metadata(token).decimals();
            if (dec > MAX_TOKEN_DECIMALS) revert UnsupportedDecimals(dec);
            tokenDecimals[token] = dec;
        }
        tokenAllowed[token] = allowed;
        emit TokenAllowedSet(token, allowed, dec);
    }

    /// @notice Allowlist a venue: `target` is called with executor-supplied data after
    /// `spender` is approved. Neither may be this contract or an allowlisted token, otherwise
    /// an executor could make this contract move users' approved tokens.
    function setSwapTarget(address target, address spender, bool allowed) external onlyOwner {
        if (allowed) {
            if (target == address(0) || spender == address(0)) revert ZeroAddress();
            if (target == address(this) || spender == address(this)) {
                revert InvalidSwapTarget(target);
            }
            if (tokenAllowed[target]) revert InvalidSwapTarget(target);
            if (tokenAllowed[spender]) revert InvalidSwapTarget(spender);
            if (target.code.length == 0) revert InvalidSwapTarget(target);
        }
        bool was = swapTargetAllowed[target][spender];
        if (was == allowed) return;
        swapTargetAllowed[target][spender] = allowed;
        if (allowed) {
            ++venueRefCount[target];
            ++venueRefCount[spender];
        } else {
            --venueRefCount[target];
            --venueRefCount[spender];
        }
        emit SwapTargetSet(target, spender, allowed);
    }

    function setExecutorFeeBps(uint16 bps) external onlyOwner {
        _setExecutorFeeBps(bps);
    }

    function setMaxOracleAge(uint32 seconds_) external onlyOwner {
        if (seconds_ == 0) revert InvalidExpiry();
        maxOracleAge = seconds_;
        emit MaxOracleAgeSet(seconds_);
    }

    /// @notice Per-token max oracle age (0 = use the default). With sponsored push feeds only,
    /// set ~heartbeat + margin (D-004).
    function setTokenMaxOracleAge(address token, uint32 seconds_) external onlyOwner {
        tokenMaxOracleAge[token] = seconds_;
        emit TokenMaxOracleAgeSet(token, seconds_);
    }

    function setMaxConfBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > FloorMath.BPS) revert InvalidConfBps();
        maxConfBps = bps;
        emit MaxConfBpsSet(bps);
    }

    function setMaxOrderUsdE18(uint256 usdE18) external onlyOwner {
        maxOrderUsdE18 = usdE18;
        emit MaxOrderUsdSet(usdE18);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ================================================================== internals

    function _setOracle(IFloorOracle oracle_) internal {
        if (address(oracle_) == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(address(oracle_));
    }

    function _setExecutorFeeBps(uint16 bps) internal {
        if (bps > MAX_EXECUTOR_FEE_BPS) revert FeeTooHigh(bps);
        executorFeeBps = bps;
        emit ExecutorFeeSet(bps);
    }

    function _validateNew(
        address tokenIn,
        address tokenOut,
        uint128 amountIn,
        uint16 maxSlippageBps,
        uint64 expiry
    ) internal view {
        if (!tokenAllowed[tokenIn]) revert TokenNotAllowed(tokenIn);
        if (!tokenAllowed[tokenOut]) revert TokenNotAllowed(tokenOut);
        if (tokenIn == tokenOut) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();
        if (maxSlippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(maxSlippageBps);
        if (expiry != 0 && expiry <= block.timestamp) revert InvalidExpiry();
        uint256 cap = maxOrderUsdE18;
        if (cap != 0) {
            // amountIn × current price, in USD (1e18). Uses the cached price: this is a size
            // limit, not a trade, so staleness doesn't matter here.
            (uint256 price,,) = oracle.getPriceE18(tokenIn);
            uint256 usd = FloorMath.convert(amountIn, tokenDecimals[tokenIn], 18, price, 1e18);
            if (usd > cap) revert OrderTooLarge(usd, cap);
        }
    }

    function _validatePrices(Kind kind, uint128 trigger, uint128 limit) internal pure {
        if (trigger == 0) revert InvalidTriggerPrice();
        // Stop-limit: the "never sell below" price must sit under the floor.
        if (kind == Kind.STOP_LOSS) {
            if (limit != 0 && limit >= trigger) revert InvalidLimitPrice();
        } else if (limit != 0) {
            revert InvalidLimitPrice();
        }
    }

    function _store(
        address tokenIn,
        address tokenOut,
        uint128 amountIn,
        uint128 trigger,
        uint128 limit,
        uint16 slippage,
        Kind kind,
        uint64 expiry
    ) internal returns (uint256 id) {
        id = nextOrderId++;
        Order storage o = _orders[id];
        o.owner = msg.sender;
        o.tokenIn = tokenIn;
        o.tokenOut = tokenOut;
        o.amountIn = amountIn;
        o.triggerPriceE18 = trigger;
        o.limitPriceE18 = limit;
        o.maxSlippageBps = slippage;
        o.kind = kind;
        o.status = Status.ACTIVE;
        o.expiry = expiry;
        // forge-lint: disable-next-line(unsafe-typecast)
        o.createdAt = uint64(block.timestamp);
        _ownerOrders[msg.sender].push(id);
        _activeIds.push(id);
        _activeIndex[id] = _activeIds.length;
        emit OrderCreated(
            id, msg.sender, kind, tokenIn, tokenOut, amountIn, trigger, limit, slippage, expiry
        );
    }

    function _ownedActive(uint256 id) internal view returns (Order storage o) {
        o = _orders[id];
        if (o.status != Status.ACTIVE) revert NotActive(id);
        if (o.owner != msg.sender) revert NotOrderOwner();
    }

    /// @dev Set a terminal status and swap-and-pop the id out of the active set.
    function _close(uint256 id, Order storage o, Status status) internal {
        o.status = status;
        uint256 idxPlusOne = _activeIndex[id];
        uint256 last = _activeIds[_activeIds.length - 1];
        _activeIds[idxPlusOne - 1] = last;
        _activeIndex[last] = idxPlusOne;
        _activeIds.pop();
        delete _activeIndex[id];
    }

    function _cancelSibling(Order storage o) internal {
        uint256 sid = o.linkedOrderId;
        if (sid == 0) return;
        Order storage s = _orders[sid];
        if (s.status != Status.ACTIVE) return;
        _close(sid, s, Status.CANCELLED);
        emit OrderCancelled(sid, s.owner);
    }

    function _isExpired(Order storage o) internal view returns (bool) {
        return o.expiry != 0 && block.timestamp >= o.expiry;
    }

    function _triggered(Order storage o, uint256 price) internal view returns (bool) {
        if (o.kind == Kind.STOP_LOSS) {
            return price <= o.triggerPriceE18 && (o.limitPriceE18 == 0 || price >= o.limitPriceE18);
        }
        return price >= o.triggerPriceE18;
    }

    /// @dev Oracle price with freshness and confidence checks. Pyth publish times can be a
    /// moment ahead of Monad's (second-resolution) block timestamp, so a future time counts as age 0.
    function _checkedPrice(address token) internal view returns (uint256 price) {
        uint256 conf;
        uint256 publishTime;
        (price, conf, publishTime) = oracle.getPriceE18(token);
        if (price == 0 || price > type(uint128).max) revert InvalidOraclePrice(token);
        if (publishTime < block.timestamp && block.timestamp - publishTime > oracleAgeFor(token)) {
            revert StalePrice(token, publishTime);
        }
        if (conf * FloorMath.BPS > uint256(maxConfBps) * price) {
            revert PriceTooUncertain(token, conf, price);
        }
    }

    /// @dev Steps 8–10 of the execute algorithm: pull from the owner, swap through the
    /// allowlisted venue with a transient exact approval, measure what actually arrived.
    function _pullAndSwap(Order storage o, SwapData calldata swap, uint256 minOut)
        internal
        returns (uint256 received)
    {
        IERC20 tokenIn = IERC20(o.tokenIn);
        IERC20 tokenOut = IERC20(o.tokenOut);
        uint256 amountIn = o.amountIn;
        address owner_ = o.owner;

        // 8. Readable error if the user moved their tokens or cut the allowance.
        uint256 bal = tokenIn.balanceOf(owner_);
        uint256 allow = tokenIn.allowance(owner_, address(this));
        if (bal < amountIn || allow < amountIn) {
            revert InsufficientBalanceOrAllowance(bal, allow, amountIn);
        }
        uint256 inBefore = tokenIn.balanceOf(address(this));
        tokenIn.safeTransferFrom(owner_, address(this), amountIn);

        // 9. Exact, transient approval; bubble up the venue's revert reason.
        uint256 outBefore = tokenOut.balanceOf(address(this));
        tokenIn.forceApprove(swap.spender, amountIn);
        (bool ok, bytes memory ret) = swap.target.call(swap.data);
        if (!ok) {
            if (ret.length == 0) revert SwapFailed();
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        tokenIn.forceApprove(swap.spender, 0);

        // 10. Judge the venue by balance deltas, never by its return value.
        received = tokenOut.balanceOf(address(this)) - outBefore;
        if (received < minOut) revert InsufficientOutput(received, minOut);
        uint256 inAfter = tokenIn.balanceOf(address(this));
        if (inAfter > inBefore) tokenIn.safeTransfer(owner_, inAfter - inBefore);
    }

    function _pageSize(uint256 total, uint256 offset, uint256 limit)
        internal
        pure
        returns (uint256)
    {
        if (offset >= total) return 0;
        uint256 left = total - offset;
        return left < limit ? left : limit;
    }
}
