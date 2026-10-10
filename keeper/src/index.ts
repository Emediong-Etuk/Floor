import { formatEther, isAddressEqual } from 'viem';
import { floorOrdersAbi } from '@floor/shared';
import { loadConfig, type KeeperConfig } from './config.ts';
import { FloorChain } from './chain.ts';
import { HermesClient } from './hermes.ts';
import { Keeper, type UpdateSource, type Venue } from './keeper.ts';
import { createLogger } from './log.ts';
import { Metrics } from './metrics.ts';
import { Notifier } from './notifier.ts';
import { startServer } from './server.ts';
import { HermesUpdates, MockRouterVenue, ZeroExVenue } from './venues.ts';
import { ZeroExClient } from './zeroex.ts';

/** Wires config → chain → keeper, subscribes to blocks and events, serves /health and /metrics. */
export async function run(cfg: KeeperConfig) {
  const log = createLogger(cfg.LOG_LEVEL);
  const chain = new FloorChain(cfg);
  const metrics = new Metrics();
  const notifier = new Notifier(cfg.NOTIFY_URL, cfg.NOTIFY_SECRET, log);

  // Refuse to start against the wrong deployment.
  const chainId = await chain.client.getChainId();
  if (chainId !== cfg.CHAIN_ID)
    throw new Error(`RPC is chain ${chainId}, config says ${cfg.CHAIN_ID}`);
  const oracle = await chain.floorOracle();
  if (!isAddressEqual(oracle, cfg.ORACLE_ADDRESS)) {
    throw new Error(`FloorOrders uses oracle ${oracle}, config says ${cfg.ORACLE_ADDRESS}`);
  }
  if (!(await chain.swapTargetAllowed(cfg.SWAP_TARGET, cfg.SWAP_SPENDER))) {
    throw new Error(
      `venue ${cfg.SWAP_TARGET}/${cfg.SWAP_SPENDER} is not allowlisted on FloorOrders`,
    );
  }

  const venue: Venue =
    cfg.MODE === 'demo'
      ? new MockRouterVenue(cfg.SWAP_TARGET, cfg.FLOOR_ADDRESS)
      : new ZeroExVenue(
          new ZeroExClient(cfg.ZEROX_API_URL, cfg.ZEROX_API_KEY ?? '', cfg.SWAP_TARGET),
          cfg.CHAIN_ID,
          cfg.FLOOR_ADDRESS,
          chain.account.address,
        );

  // D-004 option C: Hermes only when a key is configured; otherwise sponsored push prices.
  const updates: UpdateSource | undefined =
    cfg.MODE === 'live' && cfg.HERMES_URL && cfg.HERMES_API_KEY
      ? new HermesUpdates(new HermesClient(cfg.HERMES_URL, cfg.HERMES_API_KEY), (t) =>
          chain.feedId(t),
        )
      : undefined;

  const keeper = new Keeper(
    chain,
    venue,
    notifier,
    metrics,
    log,
    { gasMultiplier: cfg.GAS_MULTIPLIER },
    updates,
  );
  await keeper.resync();

  // Events keep the order set current between 30 s resyncs.
  const unwatchEvents = chain.subscriber.watchContractEvent({
    address: cfg.FLOOR_ADDRESS,
    abi: floorOrdersAbi,
    pollingInterval: cfg.POLL_INTERVAL_MS,
    onLogs: (logs) => {
      for (const l of logs) {
        const id = (l.args as { id?: bigint }).id;
        if (id === undefined) continue;
        if (l.eventName === 'OrderCreated' || l.eventName === 'OrderUpdated') {
          keeper
            .refresh(id)
            .catch((err: unknown) => log.warn({ err: String(err) }, 'refresh failed'));
        } else if (['OrderCancelled', 'OrderFilled', 'OrderExpired'].includes(l.eventName)) {
          keeper.forget(id);
        }
      }
    },
    onError: (err) => log.warn({ err: String(err) }, 'event watch error'),
  });

  // Every block (~400 ms on Monad): evaluate and fill.
  const unwatchBlocks = chain.subscriber.watchBlocks({
    pollingInterval: cfg.POLL_INTERVAL_MS,
    onBlock: (b) => void keeper.tick(b.number, b.timestamp),
    onError: (err) => log.warn({ err: String(err) }, 'block watch error'),
  });

  const resyncTimer = setInterval(() => {
    keeper.resync().catch((err: unknown) => log.warn({ err: String(err) }, 'resync failed'));
  }, cfg.RESYNC_INTERVAL_MS);

  let balanceWei = await chain.balance();
  const balanceTimer = setInterval(() => {
    chain
      .balance()
      .then((b) => {
        balanceWei = b;
        if (Number(formatEther(b)) < cfg.LOW_BALANCE_MON) {
          log.warn({ balanceMon: formatEther(b) }, 'keeper balance low: top up above 12 MON');
        }
      })
      .catch(() => undefined);
  }, 30_000);

  const health = async () => {
    const age = keeper.lastBlock ? Date.now() - keeper.lastBlock.seenAt : null;
    const lowBalance = Number(formatEther(balanceWei)) < cfg.LOW_BALANCE_MON;
    return {
      status: age === null ? 'starting' : age > 10_000 || lowBalance ? 'degraded' : 'ok',
      mode: cfg.MODE,
      chainId: cfg.CHAIN_ID,
      keeper: chain.account.address,
      floorOrders: cfg.FLOOR_ADDRESS,
      lastBlock: keeper.lastBlock?.number ?? null,
      lastBlockAgeMs: age,
      activeOrders: keeper.orders.size,
      inFlight: keeper.inFlight.size,
      pending: keeper.pending.size,
      lastFillLatencyMs: metrics.lastFillLatencyMs,
      keeperBalanceMon: formatEther(balanceWei),
      lowBalance,
    };
  };
  const wmonPrice = () => {
    // Prices map holds tokens in use; the first 18-decimal token priced < $1 is the best MON proxy we have.
    for (const [token, p] of keeper.lastPrices) {
      if (keeper.params.decimals.get(token) === 18 && p.priceE18 < 10n ** 18n) return p.priceE18;
    }
    return undefined;
  };
  const server = await startServer(cfg.HEALTH_PORT, {
    health,
    metrics: async () => metrics.snapshot(wmonPrice()),
  });
  log.info(
    {
      mode: cfg.MODE,
      chainId: cfg.CHAIN_ID,
      keeper: chain.account.address,
      active: keeper.orders.size,
      port: cfg.HEALTH_PORT,
    },
    'keeper running',
  );

  return {
    keeper,
    metrics,
    server,
    stop: async () => {
      unwatchEvents();
      unwatchBlocks();
      clearInterval(resyncTimer);
      clearInterval(balanceTimer);
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

// Entry point when run directly (pnpm keeper:dev / start).
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  run(cfg)
    .then(({ stop }) => {
      const shutdown = () => void stop().then(() => process.exit(0));
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err: unknown) => {
      console.error(String(err));
      process.exit(1);
    });
}
