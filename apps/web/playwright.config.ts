import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs only against a running stack. Set E2E_BASE_URL (e.g. http://localhost:3000) to enable;
 * without it the specs skip themselves so `pnpm test:e2e` is a safe no-op in CI without services.
 */
const baseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: baseURL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Optional: run with a locally installed Chrome when Playwright's browsers cannot be downloaded.
    launchOptions: process.env.E2E_CHROME_EXECUTABLE ? { executablePath: process.env.E2E_CHROME_EXECUTABLE } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
