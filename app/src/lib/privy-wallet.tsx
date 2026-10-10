'use client';
import { useCallback, useMemo, type ReactNode } from 'react';
import {
  PrivyProvider,
  usePrivy,
  useSendTransaction,
  useSignMessage,
  useWallets,
  type ConnectedWallet,
} from '@privy-io/react-auth';
import { createWalletClient, custom, type Address, type Hex } from 'viem';
import { CHAIN_ID, chain } from './config';
import { WalletContext, type FloorWallet, type LoginMethod, type TxRequest } from './wallet';

/**
 * Privy (production). Two ways in:
 * - email → an embedded wallet Privy creates (no seed phrase);
 * - the user's own wallet (MetaMask and others), which signs every transaction itself.
 * Loaded as its own chunk.
 */

// Embedded wallets report 'privy' (or 'privy-v2'); anything else is the user's own wallet.
const isEmbedded = (walletClientType?: string) => walletClientType?.startsWith('privy') ?? false;

/** A viem client for an external wallet, switched to Monad first (adding the network if needed). */
async function externalClient(w: ConnectedWallet) {
  const clientFor = async () =>
    createWalletClient({
      account: w.address as Address,
      chain,
      transport: custom(await w.getEthereumProvider()),
    });
  if (Number(w.chainId.split(':')[1]) !== CHAIN_ID) {
    try {
      await w.switchChain(CHAIN_ID);
    } catch {
      // The wallet doesn't know Monad yet (e.g. a fresh MetaMask): add it, which also switches.
      await (await clientFor()).addChain({ chain });
    }
  }
  // A provider fetched before the switch keeps the old chain, so build the client afterwards.
  return clientFor();
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const { signMessage: privySign } = useSignMessage();

  // The wallet the user signed in with.
  const linked = user?.wallet;
  const external = !!linked && !isEmbedded(linked.walletClientType);
  const connected = external
    ? wallets.find((w) => w.address.toLowerCase() === linked.address.toLowerCase())
    : wallets.find((w) => isEmbedded(w.walletClientType));
  const address = (connected?.address ?? linked?.address) as Address | undefined;

  const send = useCallback(
    async (tx: TxRequest) => {
      if (!address) throw new Error('Wallet not ready yet');
      if (external) {
        // The user's own wallet shows its confirmation screen for each transaction.
        if (!connected) throw new Error('Your wallet is not connected. Open it and try again.');
        const client = await externalClient(connected);
        return client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
      }
      const { hash } = await sendTransaction(
        { to: tx.to, data: tx.data, value: tx.value ?? 0n, chainId: CHAIN_ID },
        // The app shows its own step-by-step progress, so skip Privy's confirmation modal.
        { uiOptions: { showWalletUIs: false }, address },
      );
      return hash as Hex;
    },
    [address, external, connected, sendTransaction],
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!address) throw new Error('Wallet not ready yet');
      if (external) {
        if (!connected) throw new Error('Your wallet is not connected. Open it and try again.');
        return (await connected.sign(message)) as Hex;
      }
      const { signature } = await privySign(
        { message },
        { uiOptions: { showWalletUIs: false }, address },
      );
      return signature as Hex;
    },
    [address, external, connected, privySign],
  );

  const value = useMemo<FloorWallet>(
    () => ({
      ready,
      authenticated: authenticated && !!address,
      address,
      email: user?.email?.address,
      walletName: external ? (connected?.meta.name ?? 'Your wallet') : undefined,
      // No method: Privy's sign-in sheet with both options. Otherwise only the one asked for.
      login: (method?: LoginMethod) => login(method ? { loginMethods: [method] } : undefined),
      logout,
      send,
      signMessage,
    }),
    [ready, authenticated, address, user, external, connected, login, logout, send, signMessage],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export default function PrivyWallet({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#34d399',
          landingHeader: 'Sign in to Floor',
          // Monad is an EVM chain: show Ethereum wallets only. On phones, MetaMask and the
          // WalletConnect option open the wallet app.
          walletChainType: 'ethereum-only',
          walletList: ['metamask', 'detected_ethereum_wallets', 'rainbow', 'wallet_connect'],
        },
        // Optional: your own WalletConnect Cloud project id (Privy uses its default otherwise).
        walletConnectCloudProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined,
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
