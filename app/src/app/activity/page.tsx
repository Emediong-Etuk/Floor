'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OrderStatus } from '@floor/shared';
import { Card, Screen, Skeleton } from '@/components/ui';
import { findFillTx } from '@/lib/activity';
import { tokenByAddress, txUrl, USDC } from '@/lib/config';
import { amount, timeAgo, usd } from '@/lib/format';
import {
  groupProtections,
  isActive,
  useContractParams,
  useOrders,
  type Order,
  type Protection,
} from '@/lib/reads';
import { useFloorWallet } from '@/lib/wallet';

export default function ActivityPage() {
  const { address, authenticated } = useFloorWallet();
  const orders = useOrders(address);
  const params = useContractParams();
  const past = groupProtections(orders.data ?? []).filter((p) => !isActive(p));

  return (
    <Screen title="Activity">
      {!authenticated ? (
        <Card className="text-sm text-muted">
          <Link href="/" className="text-accent underline">
            Sign in
          </Link>{' '}
          to see your activity.
        </Card>
      ) : orders.isLoading ? (
        <Skeleton className="h-40" />
      ) : past.length === 0 ? (
        <Card className="text-center text-sm text-muted">No sales, cancels or expiries yet.</Card>
      ) : (
        <ul className="space-y-3">
          {past.map((p) => (
            <li key={p.key}>
              <Entry p={p} feeBps={params.data?.executorFeeBps ?? 0} />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function Entry({ p, feeBps }: { p: Protection; feeBps: number }) {
  const filled: Order | undefined = [p.stop, p.takeProfit].find(
    (o) => o?.status === OrderStatus.FILLED,
  );
  const token = tokenByAddress(p.main.tokenIn);
  const decimals = token?.decimals ?? 18;
  const [tx, setTx] = useState<string | null>();
  useEffect(() => {
    if (filled) void findFillTx(filled.id, filled.filledAt).then(setTx);
  }, [filled]);

  if (filled) {
    // amountOut is net of the executor fee: fee = gross × bps, net = gross − fee.
    const fee = feeBps > 0 ? (filled.amountOut * BigInt(feeBps)) / BigInt(10_000 - feeBps) : 0n;
    const kind = filled.kind === 0 ? 'Floor hit' : 'Cash-out hit';
    return (
      <Card className="tabular space-y-1 text-sm" data-testid={`activity-filled-${filled.id}`}>
        <div className="flex justify-between">
          <span className="font-semibold text-accent">{kind}: sold</span>
          <span className="text-muted">{timeAgo(filled.filledAt)}</span>
        </div>
        <p>
          Sold {amount(filled.amountIn, decimals)} {token?.symbol} at {usd(filled.fillPriceE18)} →{' '}
          <b>{amount(filled.amountOut, USDC.decimals, 2)} USDC</b>
        </p>
        <p className="text-muted">
          fee {amount(fee, USDC.decimals, 4)} USDC ·{' '}
          {tx ? (
            <a className="text-accent underline" href={txUrl(tx)} target="_blank" rel="noreferrer">
              View tx
            </a>
          ) : tx === null ? (
            'tx not found'
          ) : (
            'finding tx…'
          )}
        </p>
      </Card>
    );
  }
  const label = p.main.status === OrderStatus.EXPIRED ? 'Expired' : 'Cancelled';
  return (
    <Card className="tabular flex justify-between text-sm text-muted">
      <span>
        {label}: {amount(p.main.amountIn, decimals)} {token?.symbol} (floor{' '}
        {p.stop ? usd(p.stop.triggerPriceE18) : '—'})
      </span>
      <span>{timeAgo(p.main.createdAt)}</span>
    </Card>
  );
}
