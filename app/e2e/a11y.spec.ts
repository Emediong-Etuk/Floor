import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility: axe-core (WCAG 2.1 A/AA rules) on every screen at phone size, signed in
 * with a live protection so cards, bars and chips are on screen. Runs after floor.spec.ts.
 */
async function audit(page: Page, name: string) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = r.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, `${name} accessibility violations`).toEqual([]);
}

test('every screen passes axe (WCAG 2.1 AA)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  await audit(page, 'welcome');
  await page.getByRole('button', { name: 'Continue with email' }).click();

  await page.goto('/demo');
  await page.getByRole('button', { name: 'Mint test tokens' }).click();
  // "Slow down" = the faucet's 60 s per-wallet limit: floor.spec.ts just minted for this wallet.
  await expect(page.getByText(/Sent 10000 WMON|Slow down a little/)).toBeVisible();
  await audit(page, 'demo');

  await page.goto('/protect/WMON');
  await page.getByLabel('Amount to protect').fill('100');
  await page.getByRole('button', { name: 'Advanced' }).click();
  await audit(page, 'protect');
  await page.getByRole('button', { name: 'Turn on protection' }).click();
  await expect(page.getByRole('heading', { name: 'Protection is on' })).toBeVisible();
  await audit(page, 'protect success');

  await page.goto('/');
  await expect(page.locator('[data-testid^="protection-"]').first()).toBeVisible();
  await audit(page, 'home');
  await page.locator('[data-testid^="protection-"]').first().click();
  await expect(page.getByText('Floor (stop-loss)')).toBeVisible();
  await audit(page, 'protection detail');
  await page.getByRole('button', { name: 'Cancel protection' }).click();
  await expect(page.getByText('Nothing protected yet.')).toBeVisible();

  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await audit(page, 'activity');
  await page.goto('/settings');
  await expect(page.getByTestId('alerts')).toBeVisible();
  await audit(page, 'settings');
});
