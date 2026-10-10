'use client';
import { useEffect, useState } from 'react';
import {
  currentSubscription,
  disablePush,
  enablePush,
  isIos,
  isStandalone,
  pushSupported,
  VAPID_PUBLIC_KEY,
} from '@/lib/push-client';
import { useFloorWallet } from '@/lib/wallet';
import { Button, Card, ErrorNote } from './ui';

type State = 'loading' | 'unsupported' | 'ios-install' | 'off' | 'on' | 'blocked' | 'unconfigured';

/** Push alerts toggle (Settings) with the iOS "Add to Home Screen" hint. */
export function AlertsCard({ compact = false }: { compact?: boolean }) {
  const { address, signMessage } = useFloorWallet();
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void (async () => {
      if (!VAPID_PUBLIC_KEY) return setState('unconfigured');
      if (isIos() && !isStandalone()) return setState('ios-install');
      if (!pushSupported()) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      setState((await currentSubscription()) ? 'on' : 'off');
    })();
  }, []);

  const toggle = async () => {
    if (!address) return;
    setBusy(true);
    setError(undefined);
    try {
      if (state === 'on') {
        await disablePush(address);
        setState('off');
      } else {
        await enablePush(address, signMessage);
        setState('on');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied')
        setState('blocked');
    } finally {
      setBusy(false);
    }
  };

  if (
    compact &&
    (state === 'on' || state === 'loading' || state === 'unconfigured' || state === 'unsupported')
  )
    return null;

  return (
    <Card className="space-y-2 text-sm" data-testid="alerts">
      <p className="font-semibold">Sale alerts</p>
      {state === 'ios-install' && (
        <p className="text-muted">
          On iPhone, alerts only work from the installed app: tap <b>Share</b> →{' '}
          <b>Add to Home Screen</b>, then open Floor from your Home Screen and turn alerts on here.
        </p>
      )}
      {state === 'unsupported' && (
        <p className="text-muted">This browser can&apos;t show notifications.</p>
      )}
      {state === 'unconfigured' && (
        <p className="text-muted">Push alerts aren&apos;t set up on this deployment yet.</p>
      )}
      {state === 'blocked' && (
        <p className="text-muted">
          Notifications are blocked for Floor. Allow them in your browser or phone settings.
        </p>
      )}
      {(state === 'off' || state === 'on') && (
        <>
          <p className="text-muted">
            {state === 'on'
              ? 'On. This device gets a notification the moment a protection sells.'
              : 'Get a notification on this device the moment a protection sells.'}
          </p>
          <Button
            variant={state === 'on' ? 'secondary' : 'primary'}
            onClick={toggle}
            disabled={busy || !address}
          >
            {busy ? 'Working…' : state === 'on' ? 'Turn off alerts' : 'Turn on alerts'}
          </Button>
        </>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}
