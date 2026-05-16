// @ts-check

const { defineConfig } = require('@playwright/test');
const nodeProcess = /** @type {{ env?: Record<string, string | undefined> } | undefined} */ (globalThis.process);
const pythonBin = nodeProcess?.env?.WEBSQLITE_PYTHON || '/root/.virtualenvs/v1/bin/python';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: `${pythonBin} manage.py runserver 127.0.0.1:8000`,
    url: 'http://127.0.0.1:8000',
    timeout: 120000,
    reuseExistingServer: true,
  },
});
