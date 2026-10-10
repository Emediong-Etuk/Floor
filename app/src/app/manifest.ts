import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Floor: a safety net for your crypto',
    short_name: 'Floor',
    description:
      'Set a floor price on a token you hold. If it falls there, Floor sells to USDC automatically.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0f0e',
    theme_color: '#0b0f0e',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
