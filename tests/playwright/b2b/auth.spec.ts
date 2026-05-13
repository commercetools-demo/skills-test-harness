import { test, expect } from '@playwright/test';

test('B2B login page renders', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // B2B storefronts redirect unauthenticated users to login
  const loginForm = page.locator('form').filter({ has: page.locator('input[type="email"], input[name="email"]') });
  await expect(loginForm).toBeVisible({ timeout: 10000 });
});

test('B2B login page has email and password fields', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
