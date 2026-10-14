import { expect, test } from '@playwright/test';

/**
 * Smoke: landing → dashboard → create room → workspace renders
 * (Monaco + canvas) with zero page errors.
 */
test('workspace boots with editor and canvas, no page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err && err.message)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  // Fresh profile lands on the marketing page first.
  const enter = page.getByRole('button', { name: /open syncspace/i });
  if (await enter.isVisible().catch(() => false)) {
    await enter.click();
  }
  await page.getByRole('button', { name: /create room/i }).click();
  await expect(page).toHaveURL(/\?room=/);
  // Workspace shell: Monaco editor + Konva canvas mounted.
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});
