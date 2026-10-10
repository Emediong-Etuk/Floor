'use client';
import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { convert, executorFee, minOut } from '@floor/shared';
import { AlertsCard } from '@/components/alerts';
import { GasBanner } from '@/components/gas';
import { Button, Card, ErrorNote, Screen, Skeleton, Steps } from '@/components/ui';
import { approve, createProtection, pokeKeeper } from '@/lib/actions';
import { USDC, tokenBySymbol } from '@/lib/config';
import { amount, pct, scalePrice, usd } from '@/lib/format';
import { committed, useBalances, useContractParams, useOrders, usePrices } from '@/lib/reads';
import { useSteps, type Step } from '@/lib/tx';
import { useFloorWallet } from '@/lib/wallet';

const EXPIRY = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'Never', days: 0 },
];

export default function ProtectPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const token = tokenBySymbol(symbol);
  const { address, send, authenticated, login } = useFloorWallet();
  const prices = usePrices();
  const balances = useBalances(address);
  const orders = useOrders(address);
  const contract = useContractParams();
  const { steps, error, running, run } = useSteps(send);

  const [input, setInput] = useState('');
  const [floorPct, setFloorPct] = useState(10); // −10% default
  const [cashOut, setCashOut] = useState(false);
  const [cashOutPct, setCashOutPct] = useState(20); // +20% default
  const [advanced, setAdvanced] = useState(false);
  const [slippage, setSlippage] = useState(1); // %
  const [limitInput, setLimitInput] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [done, setDone] = useState(false);

  const price = token ? prices.data?.get(token.address.toLowerCase()) : undefined;
  const usdcPrice = prices.data?.get(USDC.address.toLowerCase());
  const balance = token ? (balances.data?.balances.get(token.address.toLowerCase()) ?? 0n) : 0n;
  const allowance = token ? (balances.data?.allowances.get(token.address.toLowerCase()) ?? 0n) : 0n;

  const amountIn = useMemo(() => {
    if (!token) return 0n;
    try {
      return input ? parseUnits(input, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [input, token]);
  const limitE18 = useMemo(() => {
    try {
      return limitInput ? parseUnits(limitInput, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [limitInput]);

  if (!token || !token.protectable) {
    return (
      <Screen title="Protect" back="/">
        <Card>Floor can&apos;t protect that token. Go back and pick another.</Card>
      </Screen>
    );
  }
  if (!authenticated) {
    return (
      <Screen title={`Protect ${token.symbol}`} back="/">
        <Button onClick={login}>Sign in to continue</Button>
      </Screen>
    );
  }
  if (!price || !usdcPrice || !balances.data || !contract.data) {
    return (
      <Screen title={`Protect ${token.symbol}`} back="/">
        <Skeleton className="h-96" />
      </Screen>
    );
  }

  const floorE18 = scalePrice(price, 10_000 - floorPct * 100);
  const cashOutE18 = cashOut ? scalePrice(price, 10_000 + cashOutPct * 100) : undefined;
  const slippageBps = Math.round(slippage * 100);
  const feeBps = contract.data.executorFeeBps;
  // "About" = the oracle value at the trigger, less Floor's fee; the contract guarantees at least `min`.
  const estimate = (atE18: bigint) => {
    const gross = convert(amountIn, token.decimals, USDC.decimals, atE18, usdcPrice);
    return gross - executorFee(gross, feeBps);
  };
  const atFloor = estimate(floorE18);
  const atFloorMin = minOut(
    amountIn,
    token.decimals,
    USDC.decimals,
    floorE18,
    usdcPrice,
    slippageBps,
  );
  const atCashOut = cashOutE18 ? estimate(cashOutE18) : 0n;

  const tooMuch = amountIn > balance;
  const badLimit = limitE18 > 0n && limitE18 >= floorE18;
  const canSubmit = amountIn > 0n && !tooMuch && !badLimit && !running;

  const submit = async () => {
    if (!address) return;
    const needed = committed(orders.data ?? [], token.address) + amountIn;
    const list: Step[] = [];
    // Approve exactly what Floor may ever pull for this token, never "unlimited".
    if (allowance < needed) {
      list.push({
        label: `Approve ${amount(needed, token.decimals)} ${token.symbol}`,
        build: () => approve(address, token.address, needed),
      });
    }
    list.push({
      label: 'Turn on protection',
      build: () =>
        createProtection(address, {
          tokenIn: token.address,
          tokenOut: USDC.address,
          amountIn,
          floorE18,
          cashOutE18,
          limitE18,
          slippageBps,
          expiry: expiryDays ? BigInt(Math.floor(Date.now() / 1000) + expiryDays * 86_400) : 0n,
        }),
    });
    const hashes = await run(list);
    if (hashes) {
      setDone(true);
      pokeKeeper(); // a floor already crossed sells right away
      void orders.refetch();
      void balances.refetch();
    }
  };

  if (done) {
    return (
      <Screen title="Protection is on" back="/">
        <Card className="space-y-4 text-center">
          <p className="text-5xl">🛡️</p>
          <p className="text-lg font-semibold">
            {amount(amountIn, token.decimals)} {token.symbol} is protected
          </p>
          <p className="text-sm text-muted">
            Floor at {usd(floorE18)}
            {cashOutE18 ? ` · cash-out at ${usd(cashOutE18)}` : ''}. Your tokens stay in your wallet
            until it sells.
          </p>
          <Steps steps={steps} />
          <AlertsCard compact />
          <Link href="/" className="block rounded-xl bg-accent py-3 font-semibold text-accent-ink">
            Done
          </Link>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title={`Protect ${token.symbol}`} back="/">
      <GasBanner native={balances.data.native} />
      <div className="space-y-4">
        <Card className="space-y-3">
          <label className="block text-sm text-muted" htmlFor="amount">
            Amount to protect
          </label>
          <div className="flex items-center gap-2">
            <input
              id="amount"
              inputMode="decimal"
              placeholder="0"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(',', '.'))}
              className="tabular min-w-0 flex-1 bg-transparent text-3xl font-bold outline-none"
            />
            <span className="text-lg text-muted">{token.symbol}</span>
          </div>
          <p className="tabular text-sm text-muted">
            You have {amount(balance, token.decimals)} {token.symbol} · now {usd(price)} each
          </p>
          <div className="grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setInput(formatUnits((balance * BigInt(p)) / 100n, token.decimals))}
                className="min-h-10 rounded-lg bg-surface-2 text-sm"
              >
                {p === 100 ? 'MAX' : `${p}%`}
              </button>
            ))}
          </div>
          {tooMuch && <p className="text-sm text-danger">That&apos;s more than you have.</p>}
        </Card>

        <Card className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="floor" className="font-semibold">
              Floor price
            </label>
            <span className="tabular text-lg font-bold" data-testid="floor-price">
              {usd(floorE18)} <span className="text-sm text-muted">({pct(-floorPct)})</span>
            </span>
          </div>
          <p className="text-xs text-muted">Stop-loss</p>
          <input
            id="floor"
            type="range"
            min={1}
            max={50}
            value={floorPct}
            onChange={(e) => setFloorPct(Number(e.target.value))}
            className="w-full"
            style={{ direction: 'rtl' }}
            aria-valuetext={`${floorPct}% below the current price`}
          />
        </Card>

        <Card className="space-y-2">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="font-semibold">Also cash out if it goes up</span>
              <span className="block text-xs text-muted">
                Take-profit · whichever price is hit first wins
              </span>
            </span>
            <input
              type="checkbox"
              checked={cashOut}
              onChange={(e) => setCashOut(e.target.checked)}
              className="size-6 accent-[var(--accent)]"
            />
          </label>
          {cashOut && cashOutE18 && (
            <>
              <div className="flex items-baseline justify-between pt-2">
                <label htmlFor="cashout" className="text-sm text-muted">
                  Cash-out price
                </label>
                <span className="tabular text-lg font-bold">
                  {usd(cashOutE18)} <span className="text-sm text-muted">({pct(cashOutPct)})</span>
                </span>
              </div>
              <input
                id="cashout"
                type="range"
                min={5}
                max={300}
                value={cashOutPct}
                onChange={(e) => setCashOutPct(Number(e.target.value))}
                className="w-full"
              />
            </>
          )}
        </Card>

        <Card className="space-y-3">
          <button
            type="button"
            className="flex w-full justify-between text-sm"
            onClick={() => setAdvanced(!advanced)}
            aria-expanded={advanced}
          >
            <span className="font-semibold">Advanced</span>
            <span className="text-muted">{advanced ? '−' : '+'}</span>
          </button>
          {advanced && (
            <div className="space-y-4 text-sm">
              <div>
                <div className="flex justify-between">
                  <label htmlFor="slippage">Max price difference</label>
                  <span className="tabular">{slippage.toFixed(1)}%</span>
                </div>
                <input
                  id="slippage"
                  type="range"
                  min={0.3}
                  max={5}
                  step={0.1}
                  value={slippage}
                  onChange={(e) => setSlippage(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-muted">
                  Floor never sells for less than the oracle price minus this.
                </p>
              </div>
              <div>
                <label htmlFor="limit">Never sell below (optional, $)</label>
                <input
                  id="limit"
                  inputMode="decimal"
                  placeholder="No limit"
                  value={limitInput}
                  onChange={(e) => setLimitInput(e.target.value.replace(',', '.'))}
                  className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 outline-none"
                />
                {badLimit && (
                  <p className="text-xs text-danger">Must be below your floor ({usd(floorE18)}).</p>
                )}
              </div>
              <div>
                <p>Expires</p>
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {EXPIRY.map((e) => (
                    <button
                      key={e.label}
                      type="button"
                      onClick={() => setExpiryDays(e.days)}
                      className={`min-h-10 rounded-lg text-xs ${expiryDays === e.days ? 'bg-accent text-accent-ink' : 'bg-surface-2'}`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        {amountIn > 0n && (
          <Card className="space-y-2 text-sm leading-relaxed" data-testid="summary">
            <p>
              If {token.symbol} drops to <b>{usd(floorE18)}</b> ({pct(-floorPct)}), Floor will sell{' '}
              <b>
                {amount(amountIn, token.decimals)} {token.symbol}
              </b>{' '}
              for about <b>{amount(atFloor, USDC.decimals, 2)} USDC</b> (at least{' '}
              {amount(atFloorMin, USDC.decimals, 2)}).
              {cashOutE18 && (
                <>
                  {' '}
                  If it rises to <b>{usd(cashOutE18)}</b> ({pct(cashOutPct)}), Floor will sell for
                  about <b>{amount(atCashOut, USDC.decimals, 2)} USDC</b> instead.
                </>
              )}
            </p>
            <p className="text-muted">
              Fee: {(feeBps / 100).toFixed(1)}% only when it sells. Free if it never triggers.
            </p>
            <p className="text-xs text-muted">
              In a very fast crash the sale happens at the market price at that moment, which can be
              slightly below your floor.
            </p>
          </Card>
        )}

        <Steps steps={steps} />
        <ErrorNote message={error} />
        <Button onClick={submit} disabled={!canSubmit} className="w-full">
          {running ? 'Working…' : 'Turn on protection'}
        </Button>
      </div>
    </Screen>
  );
}
