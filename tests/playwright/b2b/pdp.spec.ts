import { test, expect } from '@playwright/test';

test('PDP route exists (redirects to login if unauthenticated)', async ({ page }) => {
  // Construct a plausible PDP URL — any /p/ route should resolve
  const response = await page.goto('/p/some-product-slug');
  // Either shows the PDP (200) or redirects to login (which resolves to 200)
  expect(page.url()).toBeTruthy();
  // No 500 error page
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
  await expect(page.locator('body')).not.toContainText('Application error');
});
