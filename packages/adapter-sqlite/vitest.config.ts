import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each suite opens SQLite files of its own.
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
})
