// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4470)

/**
 * End-to-end tests against the production build, a real Postgres and the
 * fake GitHub (tests/e2e/serve.mjs). Needs DOCKET_TEST_PG_URL and a built app:
 *
 *   pnpm --filter @docket/server-platform build && pnpm test:e2e
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  // One database for the run; tests use their own logins and orgs, but run one at a time.
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: `http://127.0.0.1:${port}/readyz`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
})
