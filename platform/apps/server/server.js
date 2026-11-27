// SPDX-License-Identifier: AGPL-3.0-only
// The API process (§3): SvelteKit's request handler (adapter-node's build/handler.js),
// with the OAuth authorization server's endpoints in front of it (front.js).
//
//   PORT, HOST     where to listen (default 0.0.0.0:3000)
//   ORIGIN         the public origin; oidc-provider builds its URLs from it, never from
//                  a request's Host or X-Forwarded-* headers
//   DOCKET_MCP_APP the MCP app's page, docket_search's `ui://docket/search.html` (default:
//                  build/mcp-app/search.html beside this file, which the web build writes)
//   DOCKET_SERVE_UI false (or 0) serves the API, MCP, OAuth and sign-in without the product's pages
//
// `docket serve --config` and `docket open --config` run the same app from a docket-server.yaml
// instead (runtime.js), with the worker in the same process.
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import { handler } from './build/handler.js'
import { frontListener } from './front.js'

const origin = process.env.ORIGIN ?? 'http://127.0.0.1:3000'
const port = Number(process.env.PORT ?? 3000)
process.env.DOCKET_MCP_APP ??= fileURLToPath(new URL('./build/mcp-app/search.html', import.meta.url))
const host = process.env.HOST ?? '0.0.0.0'
const ui = process.env.DOCKET_SERVE_UI !== 'false' && process.env.DOCKET_SERVE_UI !== '0'

const server = createServer(frontListener({ handler, origin, ui }))

server.listen(port, host, () => console.log(`Listening on http://${host}:${port}`))

let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  console.log(`${signal}: finishing open requests`)
  server.close(() => process.exit(0))
  server.closeIdleConnections()
  setTimeout(() => process.exit(0), 30_000).unref()
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
