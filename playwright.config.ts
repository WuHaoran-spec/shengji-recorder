import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, permissions: ['microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
  webServer: { command: 'npm run dev -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
