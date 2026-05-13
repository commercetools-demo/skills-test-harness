import { test, expect } from '@playwright/test';

test('cart page is accessible (no 500)', async ({ page }) => {
  const response = await page.goto('/cart');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
  await expect(page.locator('body')).not.toContainText('Application error');
});
