// SPDX-License-Identifier: AGPL-3.0-only
// The API process (§3): SvelteKit's request handler (adapter-node's build/handler.js),
// with the OAuth authorization server's endpoints in front of it.
//
// MCP clients post to /oauth/token and /oauth/revoke as forms without an Origin header,
// which SvelteKit refuses as a cross-site form submission before any hook runs, so
// those endpoints (oidc-provider, made by the app's runtime at start) answer here.
// Everything else - the consent page included - is SvelteKit's.
//
//   PORT, HOST     where to listen (default 0.0.0.0:3000)
//   ORIGIN         the public origin; oidc-provider builds its URLs from it, never from
//                  a request's Host or X-Forwarded-* headers
//   DOCKET_MCP_APP the MCP app's page, docket_search's `ui://docket/search.html` (default:
//                  build/mcp-app/search.html beside this file, which the web build writes)
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import { handler } from './build/handler.js'

const OAUTH_HANDLER = Symbol.for('docket-cloud.oauth')
const origin = new URL(process.env.ORIGIN ?? 'http://127.0.0.1:3000')
const port = Number(process.env.PORT ?? 3000)
process.env.DOCKET_MCP_APP ??= fileURLToPath(new URL('./build/mcp-app/search.html', import.meta.url))
const host = process.env.HOST ?? '0.0.0.0'

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0]
  const oauth = globalThis[OAUTH_HANDLER]
  if (oauth?.handles(pathname)) {
    // The provider trusts these (proxy mode): set them from ORIGIN, whatever the client sent.
    req.headers.host = origin.host
    req.headers['x-forwarded-proto'] = origin.protocol.replace(/:$/, '')
    delete req.headers['x-forwarded-host']
    delete req.headers['x-forwarded-port']
    oauth.callback(req, res)
    return
  }
  handler(req, res, () => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
  })
})

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
