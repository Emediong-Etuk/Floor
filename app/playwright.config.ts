import { defineConfig, devices } from '@playwright/test';

// Started by e2e/run.mjs (anvil + deploy + next dev). Phone-sized viewport (build prompt §4).
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:3101',
    ...devices['Pixel 7'],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
    trace: 'retain-on-failure',
  },
  // Both specs share one wallet and one chain, so order matters: the lifecycle flow first (it
  // resets the demo price at the end), then the accessibility audit.
  projects: [
    { name: 'flow', testMatch: 'floor.spec.ts' },
    { name: 'a11y', testMatch: 'a11y.spec.ts', dependencies: ['flow'] },
  ],
});
