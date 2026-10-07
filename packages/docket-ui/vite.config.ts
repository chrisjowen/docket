import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// `vite dev` proxies the API to a running `docket open --no-open`, so the UI
// can be developed against a real repository with hot reload.
const api = process.env.DOCKET_API ?? 'http://127.0.0.1:4380'

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: { proxy: { '/api': api } },
  test: { include: ['src/**/*.test.ts'] }
})
