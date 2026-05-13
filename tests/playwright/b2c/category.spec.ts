import { test, expect } from '@playwright/test';

test('category page loads with products', async ({ page }) => {
  // Navigate to any category — the harness doesn't know the slug so we follow nav
  await page.goto('/');
  const categoryLink = page.locator('nav a').first();
  await categoryLink.click();
  await page.waitForLoadState('networkidle');
  // expect at least one product card
  const productCards = page.locator('[data-testid="product-card"], article, .product-card');
  await expect(productCards.first()).toBeVisible({ timeout: 10000 });
});
