'use client';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { OrderStatus } from '@floor/shared';
import {
  Button,
  Card,
  Chip,
  DistanceBar,
  ErrorNote,
  Screen,
  Skeleton,
  Steps,
} from '@/components/ui';
import { protectionHealth } from '@/components/protection';
import { cancelOrder, updateOrder } from '@/lib/actions';
import { findFillTx } from '@/lib/activity';
import { addressUrl, deployment, tokenByAddress, txUrl } from '@/lib/config';
import { amount, change, pct, scalePrice, usd } from '@/lib/format';
import { groupProtections, useBalances, useOrders, usePrices, type Order } from '@/lib/reads';
import { useSteps } from '@/lib/tx';
import { useFloorWallet } from '@/lib/wallet';

const STATUS = ['None', 'Active', 'Sold', 'Cancelled', 'Expired'];

export default function ProtectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { address, send } = useFloorWallet();
  const orders = useOrders(address);
  const prices = usePrices();
  const balances = useBalances(address);
  const { steps, error, running, run } = useSteps(send);
  const [editFloor, setEditFloor] = useState<number>();
  const [editCashOut, setEditCashOut] = useState<number>();

  const p = groupProtections(orders.data ?? []).find(
    (x) => String(x.main.id) === id || String(x.stop?.id) === id || String(x.takeProfit?.id) === id,
  );
  if (!p) {
    return (
      <Screen title="Protection" back="/">
        {orders.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <Card>Protection not found for this wallet.</Card>
        )}
      </Screen>
    );
  }
  const token = tokenByAddress(p.main.tokenIn);
  const decimals = token?.decimals ?? 18;
  const price = prices.data?.get(p.main.tokenIn.toLowerCase());
  const live = p.stop?.status === OrderStatus.ACTIVE || p.takeProfit?.status === OrderStatus.ACTIVE;
  const health = protectionHealth(
    p,
    price,
    balances.data?.balances.get(p.main.tokenIn.toLowerCase()),
    balances.data?.allowances.get(p.main.tokenIn.toLowerCase()),
  );

  const save = async () => {
    if (!address || !price) return;
    const list = [];
    if (p.stop && editFloor !== undefined) {
      const trigger = scalePrice(price, 10_000 - editFloor * 100);
      const s = p.stop;
      // Keep any stop-limit only if it is still below the new floor.
      const limit = s.limitPriceE18 < trigger ? s.limitPriceE18 : 0n;
      list.push({
        label: 'Move floor',
        build: () => updateOrder(address, s.id, trigger, limit, s.maxSlippageBps, s.expiry),
      });
    }
    if (p.takeProfit && editCashOut !== undefined) {
      const t = p.takeProfit;
      const trigger = scalePrice(price, 10_000 + editCashOut * 100);
      list.push({
        label: 'Move cash-out',
        build: () => updateOrder(address, t.id, trigger, 0n, t.maxSlippageBps, t.expiry),
      });
    }
    if (list.length && (await run(list))) {
      setEditFloor(undefined);
      setEditCashOut(undefined);
      void orders.refetch();
    }
  };

  const cancel = async () => {
    if (!address) return;
    if (await run([{ label: 'Cancel protection', build: () => cancelOrder(address, p.main.id) }])) {
      await orders.refetch();
      router.push('/');
    }
  };

  return (
    <Screen title={`${amount(p.main.amountIn, decimals)} ${token?.symbol ?? ''}`} back="/">
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Now</span>
            <span className="tabular text-lg font-bold">{price ? usd(price) : '…'}</span>
          </div>
          {live ? (
            <Chip tone={health === 'protected' ? 'good' : health === 'close' ? 'warn' : 'bad'}>
              {
                {
                  protected: 'Protected',
                  close: 'Close to floor',
                  selling: 'Selling…',
                  unfillable: "Can't sell: tokens moved",
                }[health]
              }
            </Chip>
          ) : (
            <Chip>
              {
                STATUS[
                  [p.stop, p.takeProfit].some((o) => o?.status === OrderStatus.FILLED)
                    ? OrderStatus.FILLED
                    : p.main.status
                ]
              }
            </Chip>
          )}
          {p.stop && price && live && (
            <DistanceBar distancePct={-change(price, p.stop.triggerPriceE18)} />
          )}
        </Card>

        {p.stop && <Leg title="Floor (stop-loss)" o={p.stop} price={price} decimals={decimals} />}
        {p.takeProfit && (
          <Leg title="Cash-out (take-profit)" o={p.takeProfit} price={price} decimals={decimals} />
        )}

        {live && price && (
          <Card className="space-y-4">
            <p className="font-semibold">Edit</p>
            {p.stop && (
              <div>
                <div className="flex justify-between text-sm">
                  <label htmlFor="edit-floor">New floor</label>
                  <span className="tabular">
                    {editFloor === undefined
                      ? 'unchanged'
                      : `${usd(scalePrice(price, 10_000 - editFloor * 100))} (${pct(-editFloor)})`}
                  </span>
                </div>
                <input
                  id="edit-floor"
                  type="range"
                  min={1}
                  max={50}
                  defaultValue={10}
                  onChange={(e) => setEditFloor(Number(e.target.value))}
                  className="w-full"
                  style={{ direction: 'rtl' }}
                />
              </div>
            )}
            {p.takeProfit && (
              <div>
                <div className="flex justify-between text-sm">
                  <label htmlFor="edit-tp">New cash-out</label>
                  <span className="tabular">
                    {editCashOut === undefined
                      ? 'unchanged'
                      : `${usd(scalePrice(price, 10_000 + editCashOut * 100))} (${pct(editCashOut)})`}
                  </span>
                </div>
                <input
                  id="edit-tp"
                  type="range"
                  min={5}
                  max={300}
                  defaultValue={20}
                  onChange={(e) => setEditCashOut(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            )}
            <Steps steps={steps} />
            <ErrorNote message={error} />
            <div className="grid grid-cols-2 gap-3">
              <Button variant="danger" onClick={cancel} disabled={running}>
                Cancel protection
              </Button>
              <Button
                onClick={save}
                disabled={running || (editFloor === undefined && editCashOut === undefined)}
              >
                Save
              </Button>
            </div>
          </Card>
        )}

        <p className="text-center text-xs text-muted">
          Order #{String(p.main.id)} on{' '}
          <a
            className="underline"
            href={addressUrl(deployment.floorOrders)}
            target="_blank"
            rel="noreferrer"
          >
            FloorOrders
          </a>
        </p>
      </div>
    </Screen>
  );
}

function Leg({
  title,
  o,
  price,
  decimals,
}: {
  title: string;
  o: Order;
  price?: bigint;
  decimals: number;
}) {
  const [tx, setTx] = useState<string | null>();
  useEffect(() => {
    if (o.status === OrderStatus.FILLED) void findFillTx(o.id, o.filledAt).then(setTx);
  }, [o.id, o.status, o.filledAt]);
  return (
    <Card className="tabular space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="font-semibold">{title}</span>
        <span>{STATUS[o.status]}</span>
      </div>
      <div className="flex justify-between text-muted">
        <span>Trigger</span>
        <span>
          {usd(o.triggerPriceE18)}{' '}
          {price && o.status === OrderStatus.ACTIVE
            ? `(${pct(change(price, o.triggerPriceE18), 1)})`
            : ''}
        </span>
      </div>
      {o.limitPriceE18 > 0n && (
        <div className="flex justify-between text-muted">
          <span>Never sell below</span>
          <span>{usd(o.limitPriceE18)}</span>
        </div>
      )}
      <div className="flex justify-between text-muted">
        <span>Max price difference</span>
        <span>{(o.maxSlippageBps / 100).toFixed(1)}%</span>
      </div>
      <div className="flex justify-between text-muted">
        <span>Expires</span>
        <span>
          {o.expiry === 0n ? 'Never' : new Date(Number(o.expiry) * 1000).toLocaleDateString()}
        </span>
      </div>
      {o.status === OrderStatus.FILLED && (
        <p className="pt-2 text-ink">
          Sold {amount(o.amountIn, decimals)} at {usd(o.fillPriceE18)} → {amount(o.amountOut, 6, 2)}{' '}
          USDC{' '}
          {tx && (
            <a className="text-accent underline" href={txUrl(tx)} target="_blank" rel="noreferrer">
              View tx
            </a>
          )}
        </p>
      )}
    </Card>
  );
}
