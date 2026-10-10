import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@floor/shared', '@floor/keeper'],
  // Monorepo: let the bundler resolve packages outside app/.
  turbopack: { root: path.resolve(import.meta.dirname, '..') },
  outputFileTracingRoot: path.resolve(import.meta.dirname, '..'),
  serverExternalPackages: ['pino'],
};

export default config;
