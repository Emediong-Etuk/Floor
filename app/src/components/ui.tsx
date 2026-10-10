'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { HTMLAttributes, ReactNode } from 'react';
import { DEMO_MODE, txUrl } from '@/lib/config';
import type { StepView } from '@/lib/tx';

export function Screen({
  title,
  back,
  children,
  action,
}: {
  title?: string;
  back?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-28 pt-4">
      {(title || back) && (
        <header className="mb-4 flex items-center gap-3">
          {back && (
            <Link
              href={back}
              aria-label="Back"
              className="-ml-2 rounded-full p-2 text-muted hover:text-ink"
            >
              ←
            </Link>
          )}
          {title && <h1 className="flex-1 text-xl font-semibold">{title}</h1>}
          {action}
        </header>
      )}
      {children}
      <p className="mt-10 text-center text-xs text-muted">
        Hackathon software · not audited · testnet demo
      </p>
    </div>
  );
}

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
  className?: string;
}) {
  const styles = {
    primary: 'bg-accent text-accent-ink hover:brightness-110',
    secondary: 'bg-surface-2 text-ink border border-line hover:bg-line',
    danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-12 rounded-xl px-4 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const styles = {
    neutral: 'bg-surface-2 text-muted',
    good: 'bg-accent/15 text-accent',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-danger/15 text-danger',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}
    >
      {children}
    </span>
  );
}

/**
 * How far the price sits above the floor. Green when comfortable, amber within 3%,
 * red at or below the floor (selling).
 */
export function DistanceBar({ distancePct }: { distancePct: number }) {
  const tone = distancePct <= 0 ? 'bg-danger' : distancePct <= 3 ? 'bg-warn' : 'bg-accent';
  const width = Math.max(4, Math.min(100, (distancePct / 30) * 100));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      role="meter"
      aria-valuenow={distancePct}
      aria-label="Distance to floor"
    >
      <div
        className={`h-full rounded-full ${tone}`}
        style={{ width: `${distancePct <= 0 ? 100 : width}%` }}
      />
    </div>
  );
}

export function Spinner() {
  return (
    <span
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden
    />
  );
}

export function Steps({ steps }: { steps: StepView[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-2" aria-label="Transaction progress">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-3 text-sm">
          <span className="flex size-6 items-center justify-center">
            {s.state === 'active' ? (
              <Spinner />
            ) : s.state === 'done' ? (
              <span className="text-accent">✓</span>
            ) : s.state === 'error' ? (
              <span className="text-danger">✕</span>
            ) : (
              <span className="size-2 rounded-full bg-line" />
            )}
          </span>
          <span className={s.state === 'pending' ? 'text-muted' : ''}>{s.label}</span>
          {s.hash && (
            <a
              className="ml-auto text-xs text-muted underline"
              href={txUrl(s.hash)}
              target="_blank"
              rel="noreferrer"
            >
              tx
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
    >
      {message}
    </p>
  );
}

export function BottomNav() {
  const path = usePathname();
  const items = [
    { href: '/', label: 'Home' },
    { href: '/activity', label: 'Activity' },
    ...(DEMO_MODE ? [{ href: '/demo', label: 'Demo' }] : []),
    { href: '/settings', label: 'Settings' },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 backdrop-blur"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-md">
        {items.map((i) => (
          <li key={i.href} className="flex-1">
            <Link
              href={i.href}
              className={`flex min-h-14 items-center justify-center text-sm ${path === i.href ? 'font-semibold text-accent' : 'text-muted'}`}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Skeleton({ className = 'h-20' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-surface ${className}`} />;
}
