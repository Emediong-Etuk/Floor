'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  PrivyProvider,
  usePrivy,
  useSendTransaction,
  useSignMessage,
  useWallets,
} from '@privy-io/react-auth';
import { createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, RPC_URL, chain } from './config';

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

const WalletContext = createContext<FloorWallet | null>(null);

export function useFloorWallet(): FloorWallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error('useFloorWallet outside WalletProvider');
  return w;
}

// ------------------------------------------------------------------ Privy (production)

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const { signMessage: privySign } = useSignMessage();
  // The embedded wallet Privy creates at first login (email → wallet, no seed phrase).
  const embedded = wallets.find((w) => w.walletClientType === 'privy');
  const address = (embedded?.address ?? user?.wallet?.address) as Address | undefined;

  const send = useCallback(
    async (tx: TxRequest) => {
      if (!address) throw new Error('Wallet not ready yet');
      const { hash } = await sendTransaction(
        { to: tx.to, data: tx.data, value: tx.value ?? 0n, chainId: CHAIN_ID },
        // The app shows its own step-by-step progress, so skip Privy's confirmation modal.
        { uiOptions: { showWalletUIs: false }, address },
      );
      return hash as Hex;
    },
    [address, sendTransaction],
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!address) throw new Error('Wallet not ready yet');
      const { signature } = await privySign(
        { message },
        { uiOptions: { showWalletUIs: false }, address },
      );
      return signature as Hex;
    },
    [address, privySign],
  );

  const value = useMemo<FloorWallet>(
    () => ({
      ready,
      authenticated: authenticated && !!address,
      address,
      email: user?.email?.address,
      login,
      logout,
      send,
      signMessage,
    }),
    [ready, authenticated, address, user, login, logout, send, signMessage],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
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
  useEffect(() => setMounted(true), []);
  if (!mounted) return <WalletContext.Provider value={LOADING}>{children}</WalletContext.Provider>;
  // A raw key in the browser is only ever acceptable on a throwaway local chain.
  if (E2E_KEY && CHAIN_ID === 31_337) return <LocalKeyWallet>{children}</LocalKeyWallet>;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-[var(--muted)]">
        Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to enable sign-in (see app/.env.example).
      </div>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email'],
        appearance: { theme: 'dark', accentColor: '#34d399', landingHeader: 'Sign in to Floor' },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
