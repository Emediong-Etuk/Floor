'use client';
import Link from 'next/link';
import { OrderStatus } from '@floor/shared';
import { tokenByAddress } from '@/lib/config';
import { amount, change, pct, usd, usdValue } from '@/lib/format';
import type { Protection } from '@/lib/reads';
import { Card, Chip, DistanceBar } from './ui';

export type Health = 'protected' | 'close' | 'selling' | 'unfillable';

export function protectionHealth(
  p: Protection,
  price: bigint | undefined,
  balance: bigint | undefined,
  allowance: bigint | undefined,
): Health {
  if (
    balance !== undefined &&
    allowance !== undefined &&
    (balance < p.main.amountIn || allowance < p.main.amountIn)
  ) {
    return 'unfillable';
  }
  if (!price) return 'protected';
  const stopActive = p.stop?.status === OrderStatus.ACTIVE;
  const tpActive = p.takeProfit?.status === OrderStatus.ACTIVE;
  if (
    (stopActive && price <= p.stop!.triggerPriceE18) ||
    (tpActive && price >= p.takeProfit!.triggerPriceE18)
  ) {
    return 'selling';
  }
  if (stopActive && change(price, p.stop!.triggerPriceE18) > -3) return 'close';
  return 'protected';
}

const CHIP: Record<Health, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  protected: { label: 'Protected', tone: 'good' },
  close: { label: 'Close to floor', tone: 'warn' },
  selling: { label: 'Selling…', tone: 'bad' },
  unfillable: { label: "Can't sell: tokens moved", tone: 'bad' },
};

export function ProtectionCard({
  p,
  price,
  balance,
  allowance,
}: {
  p: Protection;
  price?: bigint;
  balance?: bigint;
  allowance?: bigint;
}) {
  const token = tokenByAddress(p.main.tokenIn);
  const health = protectionHealth(p, price, balance, allowance);
  const floor = p.stop?.triggerPriceE18;
  const distance = price && floor ? -change(price, floor) : 100;
  return (
    <Link
      href={`/protection/${p.main.id}`}
      className="block"
      data-testid={`protection-${p.main.id}`}
    >
      <Card className="space-y-3 hover:border-accent/40">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">
              {amount(p.main.amountIn, token?.decimals ?? 18)} {token?.symbol ?? 'token'}
            </p>
            {price && (
              <p className="tabular text-sm text-muted">
                ≈ {usd(usdValue(p.main.amountIn, token?.decimals ?? 18, price))} · now {usd(price)}
              </p>
            )}
          </div>
          <Chip tone={CHIP[health].tone}>{CHIP[health].label}</Chip>
        </div>
        {floor !== undefined && (
          <>
            <DistanceBar distancePct={distance} />
            <div className="tabular flex justify-between text-sm">
              <span>
                Floor {usd(floor)}{' '}
                {price && <span className="text-muted">({pct(change(price, floor), 1)})</span>}
              </span>
              {p.takeProfit && (
                <span>
                  Cash-out {usd(p.takeProfit.triggerPriceE18)}
                  {price && (
                    <span className="text-muted">
                      {' '}
                      ({pct(change(price, p.takeProfit.triggerPriceE18), 1)})
                    </span>
                  )}
                </span>
              )}
            </div>
          </>
        )}
        {floor === undefined && p.takeProfit && (
          <p className="tabular text-sm">Cash-out at {usd(p.takeProfit.triggerPriceE18)}</p>
        )}
      </Card>
    </Link>
  );
}
