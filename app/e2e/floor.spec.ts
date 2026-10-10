import { expect, test } from '@playwright/test';

const shots = process.env.SCREENSHOT_DIR;
const snap = async (page: import('@playwright/test').Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

test.describe.configure({ mode: 'serial' });

// Surface browser errors in the test output (hydration failures otherwise look like timeouts).
test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 300)}`);
  });
});

test('sign in, get test tokens, protect WMON, crash the price, see the sale', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A safety net for your crypto.' })).toBeVisible();
  await snap(page, '1-welcome');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByText('Nothing protected yet.')).toBeVisible();

  // Demo faucet (server mints with the operator key).
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Mint test tokens' }).click();
  await expect(page.getByText(/Sent 10000 WMON/)).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('10,000', { exact: false }).first()).toBeVisible();
  await snap(page, '2-home');
  await page.getByRole('link', { name: 'Protect' }).first().click();

  // Protect flow: 1,000 WMON, floor −10% ($0.0225), cash-out +20% ($0.03).
  await page.getByLabel('Amount to protect').fill('1000');
  await expect(page.getByTestId('floor-price')).toContainText('$0.0225');
  await page.getByText('Also cash out if it goes up').click();
  const summary = page.getByTestId('summary');
  await expect(summary).toContainText('drops to $0.0225');
  await expect(summary).toContainText('rises to $0.0300');
  await snap(page, '3-protect');
  await page.getByRole('button', { name: 'Turn on protection' }).click();
  await expect(page.getByRole('heading', { name: 'Protection is on' })).toBeVisible();
  await page.getByRole('link', { name: 'Done' }).click();

  await expect(
    page.locator('[data-testid^="protection-"]').getByText('Protected', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('protected-total')).toContainText('$25.00');
  await snap(page, '4-protected');

  // The crash: the panel drops WMON 20%, the on-demand keeper sells.
  await page.goto('/demo');
  await page.getByRole('button', { name: '−20%' }).click();
  await expect(page.getByTestId('demo-result')).toContainText('Keeper sold protection #1', {
    timeout: 30_000,
  });
  await snap(page, '5-demo-sold');

  await page.goto('/');
  await expect(page.getByText('Nothing protected yet.')).toBeVisible();
  await page.goto('/activity');
  await expect(page.getByText('Floor hit: sold')).toBeVisible();
  await expect(page.getByText('19.94 USDC')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View tx' })).toBeVisible();
  await snap(page, '6-activity');

  // Put the price back for the next test.
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Reset to the starting price' }).click();
  await expect(page.getByTestId('demo-result')).toContainText('$0.025');
});

test('edit a floor, then cancel the protection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByRole('link', { name: 'Protect' }).first().click();
  await page.getByLabel('Amount to protect').fill('500');
  await page.getByRole('button', { name: 'Turn on protection' }).click();
  await expect(page.getByRole('heading', { name: 'Protection is on' })).toBeVisible();
  await page.getByRole('link', { name: 'Done' }).click();

  await page.locator('[data-testid^="protection-"]').first().click();
  await expect(page.getByText('Floor (stop-loss)')).toBeVisible();
  await page.getByLabel('New floor').fill('20'); // −20% → $0.02
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('$0.0200').first()).toBeVisible();
  await snap(page, '7-detail');

  await page.getByRole('button', { name: 'Cancel protection' }).click();
  await expect(page.getByText('Nothing protected yet.')).toBeVisible();
  await page.goto('/activity');
  await expect(page.getByText(/Cancelled: 500 WMON/)).toBeVisible();
});

test('readable error when protecting more than you hold', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByRole('link', { name: 'Protect' }).first().click();
  await page.getByLabel('Amount to protect').fill('99999999');
  await expect(page.getByText("That's more than you have.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on protection' })).toBeDisabled();
});
