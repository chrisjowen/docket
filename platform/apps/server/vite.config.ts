// SPDX-License-Identifier: AGPL-3.0-only
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [sveltekit()],
  // Workspace packages ship TypeScript source; bundle them into the server build. docket itself
  // is a built package, loaded from node_modules at run time as an npm install would be.
  ssr: { external: ['@chrisjowen/docket'], noExternal: [/^@docket\/(platform|server)-/] },
  test: { include: ['src/**/*.test.ts'] },
})
