// README screenshots at phone size against a running local app (start it with
// `node e2e/run.mjs --serve`). Real flow on anvil: faucet → protect → crash → sold.
// Run: PLAYWRIGHT_CHROMIUM_PATH=... node e2e/screenshots.mjs
import { chromium, devices } from '@playwright/test';

const base = process.env.APP_URL ?? 'http://127.0.0.1:3101';
const out = new URL('../../docs/screenshots/', import.meta.url).pathname;
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
const shot = (name) => page.screenshot({ path: `${out}${name}.png` });
// Whole page with the nav at the bottom: grow the viewport to the page height (Playwright's
// fullPage option draws fixed elements mid-page).
async function tallShot(name) {
  const vp = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height });
  await wait(300);
  await shot(name);
  await page.setViewportSize(vp);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(base);
await page.getByRole('button', { name: 'Continue with email' }).waitFor();
await shot('1-welcome');
await page.getByRole('button', { name: 'Continue with email' }).click();
await page.goto(`${base}/demo`);
await page.getByRole('button', { name: 'Mint test tokens' }).click();
await page.getByText(/Sent 10000 WMON/).waitFor();

await page.goto(`${base}/protect/WMON`);
await page.getByLabel('Amount to protect').fill('2000');
await page.getByText('Also cash out if it goes up').click();
await page.getByTestId('summary').scrollIntoViewIfNeeded();
await wait(300);
await shot('2-protect');
await page.getByRole('button', { name: 'Turn on protection' }).click();
await page.getByRole('heading', { name: 'Protection is on' }).waitFor();
await page.getByRole('link', { name: 'Done' }).click();
await page.locator('[data-testid^="protection-"]').first().waitFor();
await wait(500);
await tallShot('3-home-protected'); // total, tokens and the protection card

await page.goto(`${base}/demo`);
await page.getByRole('button', { name: '−20%' }).click();
await page
  .getByTestId('demo-result')
  .getByText(/Keeper sold/)
  .waitFor({ timeout: 30000 });
await wait(800); // the page scrolls the result into view itself
await shot('4-demo-sold');

await page.goto(`${base}/activity`);
await page.getByText('View tx').first().waitFor({ timeout: 30000 });
await shot('5-activity');
await page.goto(`${base}/settings`);
await page.getByTestId('alerts').waitFor();
await shot('6-settings');

// Leave the demo where we found it.
await page.goto(`${base}/demo`);
await page.getByRole('button', { name: 'Reset to the starting price' }).click();
await wait(2000);
await browser.close();
console.log('screenshots written to docs/screenshots/');
