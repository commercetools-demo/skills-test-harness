import { test, expect } from '@playwright/test';

test('product listing page loads (may show login prompt)', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Either products are shown (if auth is optional) or login redirect happens
  const hasProducts = await page.locator('[data-testid="product-card"], article').count();
  const hasLogin = await page.locator('input[type="email"]').count();
  expect(hasProducts + hasLogin).toBeGreaterThan(0);
});
