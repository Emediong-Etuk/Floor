import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BottomNav } from '@/components/ui';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Floor',
  description:
    'A safety net for crypto holders: set a floor price and Floor sells to USDC automatically.',
  applicationName: 'Floor',
  appleWebApp: { capable: true, title: 'Floor', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0b0f0e',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers>
          {children}
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
