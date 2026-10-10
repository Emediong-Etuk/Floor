'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, RPC_URL, chain } from './config';

type PrivyWalletComponent = typeof import('./privy-wallet').default;

export interface TxRequest {
  to: Address;
  data: Hex;
  value?: bigint;
}

/** What the app needs from a wallet. Privy in production; a local key only on anvil e2e runs. */
export interface FloorWallet {
  ready: boolean;
  authenticated: boolean;
  address?: Address;
  email?: string;
  login: () => void;
  logout: () => Promise<void>;
  send: (tx: TxRequest) => Promise<Hex>;
  /** personal_sign, e.g. to prove wallet ownership when turning on push alerts. */
  signMessage: (message: string) => Promise<Hex>;
}

export const WalletContext = createContext<FloorWallet | null>(null);

export function useFloorWallet(): FloorWallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error('useFloorWallet outside WalletProvider');
  return w;
}

// ------------------------------------------------------------------ local key (anvil e2e only)

const E2E_KEY = process.env.NEXT_PUBLIC_E2E_WALLET_KEY as Hex | undefined;

function LocalKeyWallet({ children }: { children: ReactNode }) {
  // Persist the session across reloads, like Privy does.
  const [authenticated, setAuth] = useState(() => {
    try {
      return sessionStorage.getItem('floor-e2e-auth') === '1';
    } catch {
      return false;
    }
  });
  const setAuthenticated = (v: boolean) => {
    try {
      sessionStorage.setItem('floor-e2e-auth', v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    setAuth(v);
  };
  const account = useMemo(() => privateKeyToAccount(E2E_KEY as Hex), []);
  const client = useMemo(
    () => createWalletClient({ account, chain, transport: http(RPC_URL) }),
    [account],
  );
  const value = useMemo<FloorWallet>(
    () => ({
      ready: true,
      authenticated,
      address: authenticated ? account.address : undefined,
      email: authenticated ? 'e2e@floor.local' : undefined,
      login: () => setAuthenticated(true),
      logout: async () => setAuthenticated(false),
      send: (tx) => client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n }),
      signMessage: (message) => account.signMessage({ message }),
    }),
    [authenticated, account, client],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Placeholder while the wallet SDK loads in the browser (it never runs during prerender). */
const LOADING: FloorWallet = {
  ready: false,
  authenticated: false,
  login: () => undefined,
  logout: async () => undefined,
  send: () => Promise.reject(new Error('Wallet is still loading')),
  signMessage: () => Promise.reject(new Error('Wallet is still loading')),
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const useLocalKey = Boolean(E2E_KEY) && CHAIN_ID === 31_337;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  // Privy is the biggest bundle in the app: load it as its own chunk after first paint. Until
  // it arrives, the app renders normally with a "loading" wallet (never a blank screen).
  const [Privy, setPrivy] = useState<PrivyWalletComponent>();
  useEffect(() => {
    setMounted(true);
    if (useLocalKey || !appId) return;
    void import('./privy-wallet').then((m) => setPrivy(() => m.default));
  }, [useLocalKey, appId]);

  const loading = <WalletContext.Provider value={LOADING}>{children}</WalletContext.Provider>;
  if (!mounted) return loading;
  // A raw key in the browser is only ever acceptable on a throwaway local chain.
  if (useLocalKey) return <LocalKeyWallet>{children}</LocalKeyWallet>;
  if (!appId) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-[var(--muted)]">
        Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to enable sign-in (see app/.env.example).
      </div>
    );
  }
  return Privy ? <Privy appId={appId}>{children}</Privy> : loading;
}
