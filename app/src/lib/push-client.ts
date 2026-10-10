'use client';
import type { Address, Hex } from 'viem';
import { subscribeMessage } from './push-message';

/** Browser side of push alerts: service worker, permission, subscription, signed registration. */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isIos(): boolean {
  return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** iOS only delivers web push to a PWA opened from the Home Screen. */
export function isStandalone(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask permission, subscribe this device, and register it for `address` with a wallet signature. */
export async function enablePush(
  address: Address,
  sign: (m: string) => Promise<Hex>,
): Promise<void> {
  if (!pushSupported()) throw new Error('This browser does not support notifications.');
  if (!VAPID_PUBLIC_KEY) throw new Error('Push alerts are not configured on this deployment.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error('Notifications are blocked. Allow them in your browser settings.');
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
    }));
  const json = sub.toJSON();
  const issuedAt = new Date().toISOString();
  const signature = await sign(await subscribeMessage(address, sub.endpoint, issuedAt));
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, subscription: json, signature, issuedAt }),
  });
  if (!res.ok)
    throw new Error(
      ((await res.json()) as { error?: string }).error ?? 'Could not turn on alerts.',
    );
}

export async function disablePush(address: Address): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe();
}
