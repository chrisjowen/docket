// SPDX-License-Identifier: AGPL-3.0-only
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

import { boundary } from './boundary.js'

// `vite dev` serves the UI and sends everything else - the API, sign-in, OAuth and the pages the server still
// renders - to a running server (`node platform/tests/e2e/serve.mjs`, or `docket open --config`).
const api = process.env.DOCKET_API ?? 'http://127.0.0.1:4470'
const forwarded = ['/api', '/signin', '/signout', '/auth', '/oauth', '/.well-known', '/mcp', '/favicon.svg']

export default defineConfig({
  plugins: [boundary(), sveltekit()],
  server: { proxy: Object.fromEntries(forwarded.map((path) => [path, { target: api, changeOrigin: false }])) },
  test: { include: ['src/**/*.test.ts', '*.test.ts'] }
})
