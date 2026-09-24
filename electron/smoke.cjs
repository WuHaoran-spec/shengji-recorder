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
      ...(process.env.SHENGJI_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.SHENGJI_TEST_EXECUTABLE) } : {}),
      args: [...(process.env.SHENGJI_TEST_EXECUTABLE ? [] : [root]), '--shengji-smoke-test', '--use-fake-device-for-media-stream'],
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
    // Chromium's synthetic device prevents this test from using the real microphone.
    await page.getByRole('button', { name: '转写设置' }).click();
    await page.getByRole('dialog', { name: '转写设置' }).getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: '开始录制', exact: true }).click();
    await page.getByRole('button', { name: '结束录制', exact: true }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 350));
    await page.getByRole('button', { name: '结束录制', exact: true }).click();
    await page.locator('.recording-item').first().waitFor();
    const cameraDenied = await page.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); stream.getTracks().forEach(track => track.stop()); return false; }
      catch { return true; }
    });
    assert.equal(cameraDenied, true, 'The app has no camera feature and must deny camera permission');
    console.log('Electron synthetic-microphone recording + local save passed. No real device was captured.');
    if (process.env.SHENGJI_TEST_SCREEN === '1') {
      const ownWindowId = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId());
      await page.evaluate(id => {
        const button = document.createElement('button');
        button.id = 'smoke-own-window';
        button.textContent = 'Smoke: own test window only';
        button.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
        button.onclick = async () => {
          let stream;
          try {
            const sources = await window.desktopBridge.listSources();
            const own = sources.find(source => source.id === id);
            if (!own || own.name !== document.title) throw new Error('Own app window not found; refusing to record any other source');
            await window.desktopBridge.selectSource(own.id);
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            if (stream.getAudioTracks().length) throw new Error('Unexpected audio track');
            const chunks = [];
            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            recorder.ondataavailable = event => chunks.push(event.data);
            const stopped = new Promise(resolve => recorder.onstop = resolve);
            recorder.start();
            await new Promise(resolve => setTimeout(resolve, 800));
            recorder.stop();
            await stopped;
            window.__shengjiScreenSmoke = { bytes: new Blob(chunks).size, audioTracks: stream.getAudioTracks().length };
          } catch (error) { window.__shengjiScreenSmoke = { error: String(error) }; }
          finally { stream?.getTracks().forEach(track => track.stop()); button.remove(); }
        };
        document.body.appendChild(button);
      }, ownWindowId);
      await page.locator('#smoke-own-window').click();
      await page.waitForFunction(() => Boolean(window.__shengjiScreenSmoke), undefined, { timeout: 20_000 });
      const screenResult = await page.evaluate(() => window.__shengjiScreenSmoke);
      assert.equal(screenResult.error, undefined);
      assert.equal(screenResult.audioTracks, 0);
      assert.ok(screenResult.bytes > 0);
      console.log(`Electron own-window recording passed: ${screenResult.bytes} bytes; no audio, no desktop or other window captured.`);
    }
    if (process.env.SHENGJI_TEST_AUDIO) {
      await page.getByRole('button', { name: '转写设置' }).click();
      await page.getByRole('dialog', { name: '转写设置' }).getByRole('checkbox').check();
      await page.locator('select').selectOption('en');
      await page.getByRole('button', { name: '完成', exact: true }).click();
      await page.locator('input[type="file"]').setInputFiles(path.resolve(process.env.SHENGJI_TEST_AUDIO));
      await page.locator('.transcript-segments textarea').first().waitFor({ timeout: 180_000 });
      const words = await page.locator('.transcript-segments textarea').evaluateAll(items => items.map(item => item.value).join(' '));
      assert.match(words, /quick brown fox/i, 'The offline English fixture should be recognized');
      const target = path.join(userData, 'smoke-transcript.docx');
      await application.evaluate(({ BrowserWindow }, savePath) => {
        BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => item.setSavePath(savePath));
      }, target);
      await page.getByRole('button', { name: '导出 Word', exact: true }).click();
      let document;
      for (let attempt = 0; attempt < 50; attempt++) {
        try { document = await fs.readFile(target); if (document.length > 100) break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(document?.subarray(0, 2).toString(), 'PK', 'DOCX should be a valid ZIP container');
      console.log(`Electron offline ASR + Word export passed: ${words}`);
    }
  } finally {
    if (application) await application.close();
    await fs.rm(userData, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
