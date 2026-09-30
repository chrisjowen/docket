import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 20_000,
    // Several suites start real chokidar watchers over temp directories. Run
    // files one at a time: concurrent watchers contend for filesystem event
    // delivery, and a starved watcher looks exactly like a missed event.
    fileParallelism: false
  }
})
