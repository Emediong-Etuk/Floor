'use client';
import { useState } from 'react';
import { AlertsCard } from '@/components/alerts';
import { Button, Card, Screen } from '@/components/ui';
import { CHAIN_ID, DEMO_MODE, addressUrl, chain, deployment } from '@/lib/config';
import { short } from '@/lib/format';
import { useFloorWallet } from '@/lib/wallet';

export default function SettingsPage() {
  const { address, email, authenticated, logout, login } = useFloorWallet();
  const [copied, setCopied] = useState(false);
  return (
    <Screen title="Settings">
      <div className="space-y-4">
        <Card className="space-y-3 text-sm">
          {authenticated && address ? (
            <>
              {email && (
                <div className="flex justify-between">
                  <span className="text-muted">Signed in as</span>
                  <span>{email}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Wallet</span>
                <button
                  type="button"
                  className="tabular rounded-lg bg-surface-2 px-2 py-1"
                  onClick={() => {
                    void navigator.clipboard.writeText(address);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Copied ✓' : short(address)}
                </button>
              </div>
              <a
                className="block text-accent underline"
                href={addressUrl(address)}
                target="_blank"
                rel="noreferrer"
              >
                View wallet on explorer
              </a>
            </>
          ) : (
            <Button onClick={login}>Sign in</Button>
          )}
        </Card>

        {authenticated && <AlertsCard />}

        <Card className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Network</span>
            <span>
              {chain.name} ({CHAIN_ID})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Mode</span>
            <span>{DEMO_MODE ? 'Demo (test tokens, mock prices)' : 'Live'}</span>
          </div>
          <a
            className="block text-accent underline"
            href={addressUrl(deployment.floorOrders)}
            target="_blank"
            rel="noreferrer"
          >
            FloorOrders contract
          </a>
        </Card>

        <Card className="space-y-1 text-sm text-muted">
          <p className="font-semibold text-ink">How Floor keeps you safe</p>
          <p>
            Your tokens stay in your wallet until a protection sells. You approve only the amount
            you protect.
          </p>
          <p>
            The contract checks the oracle price itself and refuses to sell below your limit, so
            nobody can sell early or cheap.
          </p>
          <p>Not audited: hackathon software. Use small amounts.</p>
        </Card>

        {authenticated && (
          <Button variant="secondary" className="w-full" onClick={() => void logout()}>
            Log out
          </Button>
        )}
      </div>
    </Screen>
  );
}
