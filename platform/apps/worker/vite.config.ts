// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config'

/**
 * The worker ships as one bundle beside the web app in the API image: the
 * workspace packages (TypeScript source, SQL migrations as `?raw`) are
 * bundled in, everything from npm stays external. `import.js` is the
 * operator's docket import, sharing its chunks with `main.js`,
 * `release-cognify-lease.js` the operator's way out of a stuck cognify
 * lease, `master-keys.js` the operator's org master keys, and `reranker.js`
 * the re-ranker pod's server.
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    target: 'node22',
    sourcemap: true,
    rollupOptions: {
      input: { main: 'src/main.ts', import: 'src/import.ts', reranker: 'src/reranker-main.ts', 'release-cognify-lease': 'src/release-cognify-lease.ts', 'master-keys': 'src/master-keys.ts' },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', format: 'es' },
    },
  },
  // npm packages are installed beside the bundle (`pnpm deploy`); only the workspace's own are bundled.
  ssr: { external: true, noExternal: [/^@docket\/(platform|server)-/] },
  test: { include: ['src/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
})
