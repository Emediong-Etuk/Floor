'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { GasBanner } from '@/components/gas';
import { ProtectionCard } from '@/components/protection';
import { Button, Card, OfflineNote, Screen, Skeleton } from '@/components/ui';
import { DEMO_MODE, TOKENS } from '@/lib/config';
import { amount, short, usd, usdValue } from '@/lib/format';
import { groupProtections, isActive, useBalances, useOrders, usePrices } from '@/lib/reads';
import { useFloorWallet } from '@/lib/wallet';

const SIGNED_IN = 'floor-signed-in';

export default function Page() {
  const w = useFloorWallet();
  // Remember whether this browser was signed in, so the next visit shows a skeleton (not a
  // flash of the welcome screen) while the wallet SDK loads. See the inline script in layout.tsx.
  useEffect(() => {
    if (!w.ready) return;
    try {
      if (w.authenticated) localStorage.setItem(SIGNED_IN, '1');
      else localStorage.removeItem(SIGNED_IN);
    } catch {
      /* storage unavailable */
    }
    if (!w.authenticated) delete document.documentElement.dataset.returning;
  }, [w.ready, w.authenticated]);

  if (!w.ready) {
    // Server-rendered welcome = fast first paint for new visitors; returning visitors see the
    // skeleton instead (CSS on html[data-returning]).
    return (
      <>
        <div className="returning-hide">
          <Welcome />
        </div>
        <div className="returning-show">
          <Screen>
            <Skeleton className="mt-16 h-40" />
          </Screen>
        </div>
      </>
    );
  }
  return w.authenticated ? <Home /> : <Welcome />;
}

function Welcome() {
  const { login, ready } = useFloorWallet();
  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center gap-8 pt-10">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">Floor</p>
          <h1 className="text-4xl font-bold leading-tight">A safety net for your crypto.</h1>
          <p className="text-lg text-muted">
            Set a floor price. If your token falls to it, Floor sells to USDC automatically, even
            while you sleep.
          </p>
        </div>
        <ol className="grid grid-cols-3 gap-2 text-center text-sm">
          {['Pick a token', 'Set your floor', 'Sleep easy'].map((s, i) => (
            <li key={s} className="rounded-2xl border border-line bg-surface p-3">
              <span className="block text-2xl font-bold text-accent">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <div className="space-y-3">
          <Button onClick={login} className="w-full" disabled={!ready}>
            {ready ? 'Continue with email' : 'Loading…'}
          </Button>
          <p className="text-center text-sm text-muted">
            No seed phrase. You stay in control of your tokens.
          </p>
        </div>
      </div>
    </Screen>
  );
}

function Home() {
  const { address } = useFloorWallet();
  const prices = usePrices();
  const balances = useBalances(address);
  const orders = useOrders(address);
  const active = groupProtections(orders.data ?? []).filter(isActive);
  const priceOf = (t: string) => prices.data?.get(t.toLowerCase());
  const protectedUsd = active.reduce((sum, p) => {
    const t = TOKENS.find((x) => x.address.toLowerCase() === p.main.tokenIn.toLowerCase());
    const price = priceOf(p.main.tokenIn);
    return t && price ? sum + usdValue(p.main.amountIn, t.decimals, price) : sum;
  }, 0n);

  return (
    <Screen
      title="Floor"
      action={
        <Link href="/settings" className="rounded-full bg-surface px-3 py-1 text-xs text-muted">
          {address ? short(address) : ''}
        </Link>
      }
    >
      <Card className="mb-4">
        <p className="text-sm text-muted">Protected</p>
        <p className="tabular text-3xl font-bold" data-testid="protected-total">
          {usd(protectedUsd)}
        </p>
        <p className="text-sm text-muted">
          {active.length} active protection{active.length === 1 ? '' : 's'}
        </p>
      </Card>

      <OfflineNote show={balances.isError || prices.isError || orders.isError} />
      <GasBanner native={balances.data?.native} />

      <section className="mb-6 space-y-3" aria-label="Your tokens">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your tokens</h2>
        {!balances.data || !prices.data ? (
          <Skeleton />
        ) : (
          <Card className="divide-y divide-line p-0">
            {TOKENS.map((t) => {
              const bal = balances.data?.balances.get(t.address.toLowerCase()) ?? 0n;
              const price = priceOf(t.address);
              return (
                <div key={t.address} className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <p className="font-semibold">{t.symbol}</p>
                    <p className="tabular text-sm text-muted">
                      {amount(bal, t.decimals)}{' '}
                      {price ? `· ${usd(usdValue(bal, t.decimals, price))}` : ''}
                    </p>
                  </div>
                  {t.protectable &&
                    (bal > 0n ? (
                      <Link
                        href={`/protect/${t.symbol}`}
                        className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
                      >
                        Protect
                      </Link>
                    ) : (
                      <span className="text-xs text-muted">
                        {DEMO_MODE ? 'Get some on Demo' : 'None yet'}
                      </span>
                    ))}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section className="space-y-3" aria-label="Active protections">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Active protections
        </h2>
        {!orders.data ? (
          <Skeleton className="h-32" />
        ) : active.length === 0 ? (
          <Card className="text-center text-sm text-muted">
            Nothing protected yet. Tap <span className="text-accent">Protect</span> on a token to
            set a floor.
          </Card>
        ) : (
          active.map((p) => (
            <ProtectionCard
              key={p.key}
              p={p}
              price={priceOf(p.main.tokenIn)}
              balance={balances.data?.balances.get(p.main.tokenIn.toLowerCase())}
              allowance={balances.data?.allowances.get(p.main.tokenIn.toLowerCase())}
            />
          ))
        )}
      </section>
    </Screen>
  );
}
