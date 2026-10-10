'use client';
import { useCallback, useMemo, type ReactNode } from 'react';
import {
  PrivyProvider,
  usePrivy,
  useSendTransaction,
  useSignMessage,
  useWallets,
} from '@privy-io/react-auth';
import type { Address, Hex } from 'viem';
import { CHAIN_ID, chain } from './config';
import { WalletContext, type FloorWallet, type TxRequest } from './wallet';

/** Privy (production): email login → embedded wallet, no seed phrase. Loaded as its own chunk. */

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

export default function PrivyWallet({ appId, children }: { appId: string; children: ReactNode }) {
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
