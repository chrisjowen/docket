import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The integration suites create a database each and run real transactions.
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
})
