'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { registerServiceWorker } from '@/lib/push-client';
import { WalletProvider } from '@/lib/wallet';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  // Installable PWA + push: register the service worker once on load.
  useEffect(() => {
    void registerServiceWorker()?.catch(() => undefined);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <WalletProvider>{children}</WalletProvider>
    </QueryClientProvider>
  );
}
