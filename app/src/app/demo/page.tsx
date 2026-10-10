'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, ErrorNote, Screen, Spinner } from '@/components/ui';
import { DEMO_MODE, TOKENS, addressUrl, deployment, txUrl } from '@/lib/config';
import { short, usd } from '@/lib/format';
import { usePrices } from '@/lib/reads';
import { useFloorWallet } from '@/lib/wallet';

interface SweepEvent {
  type: string;
  orderId?: string;
  txHash?: string;
  latencyMs?: number;
  amountOut?: string;
}
interface PriceResult {
  symbol: string;
  priceE18: string;
  previousE18: string;
  txHash: string;
  sweep: { durationMs?: number; events?: SweepEvent[]; error?: string };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

export default function DemoPage() {
  const { address, authenticated, login } = useFloorWallet();
  const prices = usePrices();
  const [symbol, setSymbol] = useState('WMON');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [faucet, setFaucet] = useState<string>();
  const [result, setResult] = useState<PriceResult>();
  const [custom, setCustom] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);
  // On a phone the outcome sits below the price buttons: bring it into view when it arrives.
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [result]);
  const status = useQuery({
    queryKey: ['keeper-status'],
    refetchInterval: 5_000,
    queryFn: async () =>
      (await fetch('/api/keeper/status')).json() as Promise<Record<string, unknown>>,
  });
  const gap = useQuery({
    queryKey: ['gap'],
    refetchInterval: 5_000,
    queryFn: async () => ((await (await fetch('/api/demo/gap')).json()) as { on: boolean }).on,
  });

  if (!DEMO_MODE) {
    return (
      <Screen title="Demo">
        <Card>The demo panel is only available in demo mode.</Card>
      </Screen>
    );
  }

  const token = TOKENS.find((t) => t.symbol === symbol)!;
  const price = prices.data?.get(token.address.toLowerCase());

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
      void prices.refetch();
      void status.refetch();
      void gap.refetch();
    }
  };

  const move = (bps: number | 'reset') =>
    act(String(bps), async () => {
      setResult(undefined);
      setResult(
        await post<PriceResult>(
          '/api/demo/price',
          bps === 'reset' ? { symbol, reset: true } : { symbol, bps },
        ),
      );
    });

  const filled = result?.sweep.events?.filter((e) => e.type === 'filled') ?? [];
  const waiting = result?.sweep.events?.filter((e) => e.type === 'waiting-liquidity') ?? [];

  return (
    <Screen title="Demo panel">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Testnet only. Prices here come from a mock oracle you control, so you can watch a
          protection fire.
        </p>

        <Card className="space-y-3">
          <p className="font-semibold">1. Get test tokens</p>
          {authenticated ? (
            <>
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() =>
                  act('faucet', async () => {
                    const r = await post<{ monSent: string; minted: Record<string, string> }>(
                      '/api/faucet',
                      { address },
                    );
                    setFaucet(
                      `Sent ${Object.entries(r.minted)
                        .map(([s, a]) => `${a} ${s}`)
                        .join(' + ')}${r.monSent !== '0' ? ` + ${r.monSent} MON for fees` : ''}.`,
                    );
                  })
                }
              >
                {busy === 'faucet' ? 'Sending…' : 'Mint test tokens'}
              </Button>
              {faucet && <p className="text-sm text-accent">{faucet}</p>}
            </>
          ) : (
            <Button onClick={() => login()}>Sign in first</Button>
          )}
        </Card>

        <Card className="space-y-2">
          <p className="font-semibold">2. Protect a token</p>
          <Link
            href="/protect/WMON"
            className="block rounded-xl bg-accent py-3 text-center font-semibold text-accent-ink"
          >
            Protect WMON
          </Link>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">3. Move the price</p>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm"
              aria-label="Token"
            >
              {TOKENS.filter((t) => t.protectable).map((t) => (
                <option key={t.symbol}>{t.symbol}</option>
              ))}
            </select>
          </div>
          <p className="tabular text-2xl font-bold" data-testid="demo-price">
            {price ? usd(price) : '…'}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="danger" disabled={!!busy} onClick={() => move(-500)}>
              −5%
            </Button>
            <Button variant="danger" disabled={!!busy} onClick={() => move(-2_000)}>
              −20%
            </Button>
            <Button variant="secondary" disabled={!!busy} onClick={() => move(2_000)}>
              +20%
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              inputMode="decimal"
              placeholder="Custom % e.g. -12"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 outline-none"
            />
            <Button
              variant="secondary"
              disabled={!!busy || !custom}
              onClick={() => move(Math.round(Number(custom) * 100))}
            >
              Apply
            </Button>
          </div>
          <button
            type="button"
            className="text-sm text-muted underline"
            disabled={!!busy}
            onClick={() => move('reset')}
          >
            Reset to the starting price
          </button>
          {busy && busy !== 'faucet' && busy !== 'gap' && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Moving the price, then the keeper checks every protection…
            </p>
          )}
          {result && (
            <div ref={resultRef} className="space-y-1 text-sm" data-testid="demo-result">
              <p>
                {result.symbol} {usd(BigInt(result.previousE18))} →{' '}
                <b>{usd(BigInt(result.priceE18))}</b>{' '}
                <a
                  className="text-muted underline"
                  href={txUrl(result.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  tx
                </a>
              </p>
              {filled.map((e) => (
                <p key={e.orderId} className="text-accent">
                  Keeper sold protection #{e.orderId}{' '}
                  {e.latencyMs !== undefined
                    ? `${(e.latencyMs / 1000).toFixed(1)} s after the floor was hit`
                    : ''}{' '}
                  {e.txHash && (
                    <a
                      className="underline"
                      href={txUrl(e.txHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view
                    </a>
                  )}
                </p>
              ))}
              {waiting.map((e) => (
                <p key={e.orderId} className="text-warn">
                  Protection #{e.orderId} hit its floor, but the market can&apos;t pay within its
                  limit. Waiting for liquidity.
                </p>
              ))}
              {result.sweep.error && <p className="text-danger">Keeper: {result.sweep.error}</p>}
              {!result.sweep.error && filled.length === 0 && waiting.length === 0 && (
                <p className="text-muted">No protection needed to sell at this price.</p>
              )}
            </div>
          )}
        </Card>

        <Card className="space-y-2">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="font-semibold">Liquidity gap</span>
              <span className="block text-xs text-muted">
                The demo market pays 3% under the oracle price. Floor refuses to sell below your
                limit.
              </span>
            </span>
            <input
              type="checkbox"
              className="size-6 accent-[var(--accent)]"
              checked={gap.data ?? false}
              disabled={!!busy || gap.isLoading}
              onChange={(e) =>
                act('gap', async () => void (await post('/api/demo/gap', { on: e.target.checked })))
              }
            />
          </label>
        </Card>

        <Card className="space-y-1 text-sm">
          <p className="font-semibold">Keeper</p>
          {status.data ? (
            <>
              <p className="text-muted">
                Mode: on demand (runs after every price move or new protection). Active protections:{' '}
                {String(status.data.activeOrders)}
              </p>
              {typeof status.data.keeper === 'string' && (
                <p className="text-muted">
                  <a
                    className="underline"
                    href={addressUrl(status.data.keeper)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(status.data.keeper)}
                  </a>{' '}
                  · {Number(status.data.balanceMon).toFixed(3)} MON
                </p>
              )}
              {status.data.configured === false && (
                <p className="text-warn">Keeper key not configured on the server.</p>
              )}
            </>
          ) : (
            <p className="text-muted">Loading…</p>
          )}
          <a
            className="text-accent underline"
            href={addressUrl(deployment.floorOrders)}
            target="_blank"
            rel="noreferrer"
          >
            FloorOrders contract
          </a>
        </Card>

        <ErrorNote message={error} />
      </div>
    </Screen>
  );
}
