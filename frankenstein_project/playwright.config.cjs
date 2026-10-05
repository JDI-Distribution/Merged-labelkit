const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/operations.spec.cjs',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 8000 },
  use: {
    baseURL: process.env.OPERATIONS_BASE_URL || 'http://127.0.0.1:9000',
    headless: true,
    viewport: { width: 1366, height: 900 },
  },
});