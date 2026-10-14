import { expect, test } from '@playwright/test';

/**
 * Two-client code collaboration over real browser contexts against the
 * real socket server: A<->B propagation, late join, and room isolation.
 * Synchronization here is Socket.IO revision relay (LWW), not CRDT.
 */

async function editorText(page) {
  // Monaco renders spaces as non-breaking spaces in the view DOM.
  const raw = (await page.locator('.monaco-editor .view-lines').textContent()) ?? '';
  return raw.split(String.fromCharCode(160)).join(' ');
}

// NOTE: keyboard.type() is intentionally NOT used here. It emits
// beforeinput WITHOUT the follow-up input event, a synthetic stream real
// keyboards never produce; Monaco 0.56 intermittently misapplies it
// (cursor reset + rotated text). Per-character press() sends faithful
// trusted key events and is stable.
async function pressType(page, text) {
  // Small inter-key pause: sustained back-to-back synthetic key events can
  // outpace the editor's async input pipeline in ways human typing (and
  // OS key repeat) cannot; the pause keeps input faithful without hiding
  // real behavior. See the audit notes on synthetic input rates.
  for (const ch of text) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(15);
  }
}

async function typeInEditor(page, text) {
  await page.locator('.monaco-editor .view-lines').click();
  // Deterministic append position: view-line clicks land mid-text.
  await page.keyboard.press('End');
  await pressType(page, text);
}

async function replaceEditorContent(page, text) {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await pressType(page, text);
}

test('code updates flow A->B and B->A in the same room', async ({ browser }) => {
  const room = `e2e-code-${Date.now()}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    await a.goto(`/?room=${room}`);
    await b.goto(`/?room=${room}`);
    await expect(a.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
    await expect(b.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });

    await typeInEditor(a, 'hello from A');
    await expect.poll(async () => editorText(b), { timeout: 15000 }).toContain('hello from A');

    await typeInEditor(b, ' + hello from B');
    await expect.poll(async () => editorText(a), { timeout: 15000 }).toContain('hello from B');
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('late joiner receives current file content', async ({ browser }) => {
  const room = `e2e-late-${Date.now()}`;
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  try {
    await a.goto(`/?room=${room}`);
    await expect(a.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
    await replaceEditorContent(a, 'shared content v9');

    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    try {
      await b.goto(`/?room=${room}`);
      await expect(b.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
      await expect.poll(async () => editorText(b), { timeout: 15000 }).toContain('shared content v9');
    } finally {
      await ctxB.close();
    }
  } finally {
    await ctxA.close();
  }
});

test('rooms stay isolated from each other', async ({ browser }) => {
  const stamp = Date.now();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    await a.goto(`/?room=e2e-iso-a-${stamp}`);
    await b.goto(`/?room=e2e-iso-b-${stamp}`);
    await expect(a.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });
    await expect(b.locator('.monaco-editor')).toBeVisible({ timeout: 30000 });

    await typeInEditor(a, 'room-a-secret-xyz');
    await expect.poll(async () => editorText(a), { timeout: 15000 }).toContain('room-a-secret-xyz');
    // B must never observe A's room content (presence of absence, polled).
    await expect
      .poll(async () => editorText(b), { timeout: 8000 })
      .not.toContain('room-a-secret-xyz');
    // Positive control: B's own client is functional (sync would surface
    // here if isolation were broken the other way), and A never sees it.
    await typeInEditor(b, 'room-b-alone-xyz');
    await expect.poll(async () => editorText(b), { timeout: 15000 }).toContain('room-b-alone-xyz');
    await expect.poll(async () => editorText(a), { timeout: 5000 }).not.toContain('room-b-alone-xyz');
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
