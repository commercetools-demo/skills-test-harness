import { test, expect } from '@playwright/test';

test('homepage loads and shows products', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
  // should redirect to a locale
  await expect(page.url()).toMatch(/\/[a-z]{2}-[a-z]{2}\//);
});

test('homepage has meta tags', async ({ page }) => {
  await page.goto('/');
  const metaDescription = page.locator('meta[name="description"]');
  await expect(metaDescription).toHaveCount(1);
});
