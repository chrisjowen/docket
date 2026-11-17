import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The Postgres suites create a database each and run real transactions.
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
})
