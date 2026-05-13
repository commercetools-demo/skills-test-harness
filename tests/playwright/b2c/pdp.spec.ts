import { test, expect } from '@playwright/test';

test('PDP loads from category', async ({ page }) => {
  await page.goto('/');
  const categoryLink = page.locator('nav a').first();
  await categoryLink.click();
  await page.waitForLoadState('networkidle');
  const productLink = page.locator('a[href*="/p/"]').first();
  await productLink.click();
  await page.waitForLoadState('networkidle');
  await expect(page.url()).toContain('/p/');
  // product name should be visible
  const heading = page.locator('h1');
  await expect(heading).toBeVisible();
});
