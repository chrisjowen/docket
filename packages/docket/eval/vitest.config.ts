import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/** `pnpm eval:ask`: the evaluations that call models, kept out of `pnpm test`. */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['eval/**/*.eval.ts'],
    // Progress and the score table go straight to the terminal as they are written.
    disableConsoleIntercept: true
  }
})
