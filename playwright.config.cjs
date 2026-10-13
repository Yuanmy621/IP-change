const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // The isolated preview server owns one simulated session.
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:18769',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
    { name: 'phone', use: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node scripts/preview-ui.cjs',
    url: 'http://127.0.0.1:18769',
    env: { DINGDIAN_PREVIEW_PORT: '18769' },
    reuseExistingServer: false,
  },
});
