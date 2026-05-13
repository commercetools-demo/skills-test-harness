import { test, expect } from '@playwright/test';

test('checkout page renders address form', async ({ page }) => {
  await page.goto('/');
  const categoryLink = page.locator('nav a').first();
  await categoryLink.click();
  await page.waitForLoadState('networkidle');
  const productLink = page.locator('a[href*="/p/"]').first();
  await productLink.click();
  await page.waitForLoadState('networkidle');
  const addToCartBtn = page.locator('button').filter({ hasText: /add to cart/i });
  await addToCartBtn.click();
  await page.goto('/checkout');
  await page.waitForLoadState('networkidle');
  // should show address step or login prompt
  const form = page.locator('form');
  await expect(form).toBeVisible({ timeout: 10000 });
});
