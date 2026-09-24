'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('@playwright/test');

(async () => {
  const root = path.resolve(__dirname, '..');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'shengji-smoke-'));
  let application;
  try {
    application = await electron.launch({
      args: [root],
      env: { ...process.env, SHENGJI_TEST_USER_DATA: userData },
    });
    const page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#root').locator(':scope > *').first().waitFor();
    assert.equal(page.url(), 'shengji://app/');
    const state = await page.evaluate(async () => {
      const manifest = await fetch('./offline-manifest.json');
      const wasm = await fetch('./ort/ort-wasm-simd-threaded.wasm', { method: 'HEAD' });
      const networkBlocked = await fetch('https://example.com/').then(() => false, () => true);
      const invalidSelectionBlocked = await window.desktopBridge.selectSource('screen:invalid:0').then(() => false, () => true);
      return {
        secure: window.isSecureContext,
        nodeHidden: typeof window.require === 'undefined',
        bridge: typeof window.desktopBridge.listSources === 'function',
        manifestOk: manifest.ok,
        manifestType: manifest.headers.get('content-type'),
        wasmOk: wasm.ok,
        wasmType: wasm.headers.get('content-type'),
        networkBlocked, invalidSelectionBlocked,
      };
    });
    assert.equal(state.secure, true, 'Capture requires a secure app origin');
    assert.equal(state.nodeHidden, true, 'Renderer must not have Node access');
    assert.equal(state.bridge, true);
    assert.equal(state.manifestOk, true, 'Run model:prepare before the packaged smoke test');
    assert.match(state.manifestType, /application\/json/);
    assert.equal(state.wasmOk, true);
    assert.equal(state.wasmType, 'application/wasm');
    assert.equal(state.networkBlocked, true);
    assert.equal(state.invalidSelectionBlocked, true);
    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
    });
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    console.log('Electron smoke passed: local UI, offline assets, permissions boundary, sandbox.');
  } finally {
    if (application) await application.close();
    await fs.rm(userData, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
