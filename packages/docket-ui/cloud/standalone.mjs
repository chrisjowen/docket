#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Serves the built web UI on its own, in front of a Docket server: the UI's files and pages from here, and
// every other address - the API (/api), sign-in, OAuth, MCP and the pages the server still renders - passed
// through to the server, so the browser sees one origin and the session cookie and CSRF token work as they do
// on the server itself. Dependency-free Node; any reverse proxy can do the same (README.md).
//
//   node standalone.mjs --api http://127.0.0.1:4390 [--port 4400] [--host 127.0.0.1] [--site build] [--check]
//
//   --api / DOCKET_API_URL   the server, which must be told this host's origin as its public URL (ORIGIN,
//                            or publicUrl in docket-server.yaml): sign-in, OAuth and CSRF go by it
//   --port / PORT, --host / HOST   where to listen (default 127.0.0.1:4400)
//   --site                   the built UI (default build/ beside this file, else site/ in a packed artifact)
//   --check                  check the server's API version against the UI's and exit: 0 when they fit
//   DOCKET_FRAME_ANCESTORS   loopback origins that may frame the page, for a local preview shown in a tool
//                            (as the server takes it); anything else is refused, and the page is never framed
//
// At start it asks the server for its API version (GET /api/v1/openapi.json) and refuses to serve a UI built for another
// one; a server it cannot reach yet is retried by the page itself, which checks again in the browser.
import { existsSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { compatible, webUi } from './serve.js'

const { values } = parseArgs({
  options: {
    api: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    site: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
})

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const site = values.site ?? [here('./build'), here('./site')].find((dir) => existsSync(`${dir}/index.html`))
const api = new URL(values.api ?? process.env.DOCKET_API_URL ?? 'http://127.0.0.1:4390')
const port = Number(values.port ?? process.env.PORT ?? 4400)
const host = values.host ?? process.env.HOST ?? '127.0.0.1'

/** Who may frame the page: nobody, or loopback origins for a local preview (the server's rule, preview.ts). */
const FRAME_SOURCE = /^('self'|http:\/\/(\*\.)?localhost(:(\d+|\*))?|http:\/\/127\.0\.0\.1(:(\d+|\*))?)$/
const framers = (process.env.DOCKET_FRAME_ANCESTORS ?? '').trim().split(/\s+/).filter(Boolean)
const refusedFramer = framers.find((source) => !FRAME_SOURCE.test(source))
if (refusedFramer) {
  console.error(`standalone: DOCKET_FRAME_ANCESTORS lists loopback origins like http://localhost:4310, not ${refusedFramer}`)
  process.exit(1)
}

const web = site ? webUi(site, { frameAncestors: framers.join(' ') || "'none'" }) : null
if (!web) {
  console.error(`standalone: no built web UI at ${site ?? 'build/ or site/'}; run \`pnpm build\` first`)
  process.exit(1)
}
const { name, version, api: wanted } = web.manifest

/** The server's API version (its OpenAPI document's), or what went wrong asking. */
async function served() {
  try {
    const response = await fetch(new URL('/api/v1/openapi.json', api), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) return { error: `GET /api/v1/openapi.json answered ${response.status}` }
    return { version: String((await response.json()).info?.version ?? '') }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
}

const found = await served()
if ('version' in found && !compatible(wanted, found.version)) {
  console.error(`standalone: ${name}@${version} needs Docket API ${wanted}, and ${api.origin} answers ${found.version}. Use the web UI released with that server.`)
  process.exit(1)
}
if (values.check) {
  if ('error' in found) {
    console.error(`standalone: cannot check ${api.origin}: ${found.error}`)
    process.exit(1)
  }
  console.log(`standalone: ${name}@${version} (API ${wanted}) fits ${api.origin} (API ${found.version})`)
  process.exit(0)
}
if ('error' in found) console.warn(`standalone: cannot reach ${api.origin} yet (${found.error}); the page checks its API version itself`)

/** Passes a request through to the server, as a reverse proxy does: same method, path, headers and body. */
function forward(req, res) {
  const send = api.protocol === 'https:' ? httpsRequest : httpRequest
  const address = req.socket.remoteAddress ?? ''
  const upstream = send(
    {
      protocol: api.protocol,
      hostname: api.hostname,
      port: api.port,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        'x-forwarded-for': req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${address}` : address,
        'x-forwarded-proto': 'http',
        'x-forwarded-host': req.headers.host ?? '',
      },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    },
  )
  upstream.on('error', (cause) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`The Docket server at ${api.origin} did not answer: ${cause.message}`)
  })
  req.pipe(upstream)
}

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0]
  if (web.handles(pathname)) web.serve(req, res)
  else forward(req, res)
})
server.listen(port, host, () => console.log(`standalone: ${name}@${version} at http://${host}:${port}/, its API at ${api.origin}`))

const stop = () => server.close(() => process.exit(0))
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
