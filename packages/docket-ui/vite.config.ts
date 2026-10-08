import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

import { FIXTURE_ADAPTERS, FIXTURE_ANSWER } from './src/lib/ask/fixtures.js'

// `vite dev` proxies the API to a running `docket open --no-open`, so the UI
// can be developed against a real repository with hot reload.
const api = process.env.DOCKET_API ?? 'http://127.0.0.1:4380'

/**
 * `pnpm dev:fixtures`: serves the coordinator's API - `POST /api/ask` and
 * `GET /api/adapters` - from the fixture answers, ahead of the proxy, so the
 * Ask workspace can be worked on before the server provides them. Dev only.
 */
const fixtures = (): Plugin => ({
  name: 'docket-fixtures',
  apply: 'serve',
  configureServer(server) {
    if (process.env.DOCKET_UI_FIXTURES !== '1') return
    server.middlewares.use((request, response, next) => {
      const send = (body: unknown): void => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(body))
      }
      if (request.method === 'GET' && request.url === '/api/adapters') return send(FIXTURE_ADAPTERS)
      if (request.method !== 'POST' || request.url !== '/api/ask') return next()
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        const asked = JSON.parse(body || '{}') as { requestId?: string; question?: string; adapters?: string[]; synthesis?: boolean }
        const results = FIXTURE_ANSWER.results.filter((result) => !asked.adapters || asked.adapters.includes(result.adapter))
        // Slow enough to see each adapter being asked.
        setTimeout(
          () =>
            send({
              ...FIXTURE_ANSWER,
              requestId: asked.requestId ?? FIXTURE_ANSWER.requestId,
              question: asked.question ?? FIXTURE_ANSWER.question,
              results,
              ...(asked.synthesis === false ? { synthesis: null, notice: { reason: 'disabled', message: 'Not asked for.' } } : {})
            }),
          900
        )
      })
    })
  }
})

export default defineConfig({
  plugins: [tailwindcss(), fixtures(), sveltekit()],
  server: { proxy: { '/api': api } },
  test: { include: ['src/**/*.test.ts'] }
})
