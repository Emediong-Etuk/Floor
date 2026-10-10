/**
 * The message a wallet signs to prove it owns the address it subscribes alerts for.
 * Shared by the browser (to sign) and the server (to verify). Binds the address, a short
 * device id (SHA-256 of the push endpoint) and a timestamp, so a signature can't be replayed
 * for another device or reused later.
 */
export async function deviceId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function subscribeMessage(
  address: string,
  endpoint: string,
  issuedAt: string,
): Promise<string> {
  return [
    'Floor: send price alerts for this wallet to this device.',
    `Wallet: ${address.toLowerCase()}`,
    `Device: ${await deviceId(endpoint)}`,
    `Issued: ${issuedAt}`,
  ].join('\n');
}

export const SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;
