import { test, expect } from '@playwright/test';

test('add to cart from PDP', async ({ page }) => {
  await page.goto('/');
  const categoryLink = page.locator('nav a').first();
  await categoryLink.click();
  await page.waitForLoadState('networkidle');
  const productLink = page.locator('a[href*="/p/"]').first();
  await productLink.click();
  await page.waitForLoadState('networkidle');
  const addToCartBtn = page.locator('button').filter({ hasText: /add to cart/i });
  await addToCartBtn.click();
  // mini-cart or cart count should update
  const cartIndicator = page.locator('[data-testid="cart-count"], [aria-label*="cart"]');
  await expect(cartIndicator).toBeVisible({ timeout: 5000 });
});
