'use client';
import { useState } from 'react';
import { formatEther, parseEther } from 'viem';
import { DEMO_MODE, FAUCET_URL } from '@/lib/config';
import { useFloorWallet } from '@/lib/wallet';
import { Button, Card } from './ui';

const LOW_GAS = parseEther('0.05');

export function GasBanner({ native }: { native?: bigint }) {
  const { address } = useFloorWallet();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  if (native === undefined || native >= LOW_GAS) return null;
  const drip = async () => {
    setState('busy');
    const r = await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    }).catch(() => null);
    setState(r?.ok ? 'done' : 'error');
  };
  return (
    <Card className="mb-4 border-warn/40">
      <p className="text-sm">
        You have {Number(formatEther(native)).toFixed(4)} MON. Floor needs a little MON for network
        fees.
      </p>
      {DEMO_MODE ? (
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={drip}
            disabled={state === 'busy' || state === 'done'}
          >
            {state === 'busy' ? 'Sending…' : state === 'done' ? 'Sent ✓' : 'Get test MON + tokens'}
          </Button>
          {state === 'error' && (
            <a
              className="text-sm text-muted underline"
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
            >
              Use the Monad faucet
            </a>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted">Add a little MON to your wallet to continue.</p>
      )}
    </Card>
  );
}
