import { test, expect } from '@playwright/test';

test('quotes page is accessible (no 500)', async ({ page }) => {
  const response = await page.goto('/quotes');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
  await expect(page.locator('body')).not.toContainText('Application error');
  await expect(page.locator('body')).not.toContainText('Unhandled Runtime Error');
});
