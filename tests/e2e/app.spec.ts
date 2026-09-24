import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

function silentWav() {
  const samples = 16000, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}

test('local import, editable transcript, valid Word export and persistence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让声音，成为文字。' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: '测试录音.wav', mimeType: 'audio/wav', buffer: silentWav() });
  await expect(page.getByText('没有识别到语音', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '手动输入逐字稿' }).fill('这是一份离线逐字稿，所有内容保存在本机。');
  await page.getByRole('button', { name: '保存文字', exact: true }).click();
  await page.getByRole('textbox', { name: '第 1 段逐字稿' }).fill('这是校对后的中文逐字稿。编号 2026，金额 123 元。');
  await page.getByRole('heading', { name: '逐字稿', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Word' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('测试录音.docx');
  const bytes = await readFile((await download.path())!);
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
  expect(xml).toContain('这是校对后的中文逐字稿');
  expect(xml).toContain('2026');
  await page.reload();
  await page.getByRole('button', { name: /测试录音/ }).click();
  await expect(page.getByRole('textbox', { name: '第 1 段逐字稿' })).toHaveValue('这是校对后的中文逐字稿。编号 2026，金额 123 元。');
  await page.getByRole('button', { name: '删除此录制' }).click();
  await page.getByRole('button', { name: '保留', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '修改录制标题' })).toHaveValue('测试录音');
  expect(errors).toEqual([]);
});

test('real MediaRecorder lifecycle with synthetic microphone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '转写设置' }).click();
  await page.getByRole('checkbox', { name: /结束录制后自动转写/ }).uncheck();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('textbox', { name: '录制标题', exact: true }).fill('录音流程验证');
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  await expect(page.getByRole('button', { name: '结束录制', exact: true })).toBeEnabled();
  await expect(page.locator('.timer')).not.toHaveText('00:00');
  await page.getByRole('button', { name: '结束录制', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '修改录制标题' })).toHaveValue('录音流程验证');
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出原始录制' }).click();
  const download = await event;
  expect((await readFile((await download.path())!)).length).toBeGreaterThan(100);
});

test('desktop and phone layouts keep core controls visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('storage quota failure keeps the warning and the original export available', async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('Test storage is full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: '未入库的录音.wav', mimeType: 'audio/wav', buffer: silentWav() });
  await expect(page.getByRole('status')).toContainText('本地保存失败');
  await expect(page.getByRole('button', { name: '导出原始录制' })).toBeEnabled();
  await expect(page.getByRole('status')).not.toContainText('已保存在本机');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出原始录制' }).click();
  const download = await event;
  expect((await readFile((await download.path())!)).length).toBe(silentWav().length);
  await expect(page.getByRole('status')).toContainText('本地保存失败');
});
