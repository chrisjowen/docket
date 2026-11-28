// SPDX-License-Identifier: AGPL-3.0-only
// The request listener in front of SvelteKit's handler, shared by server.js (the image's
// entry) and runtime.js (docket serve and docket open):
//
// MCP clients post to /oauth/token and /oauth/revoke as forms without an Origin header,
// which SvelteKit refuses as a cross-site form submission before any hook runs, so
// those endpoints (oidc-provider, made by the app's runtime at start) answer here.
// The web UI (packages/docket-ui/cloud, built into ui/ beside this file) answers its own
// files and the pages it draws. Everything else - the API, the consent page and the pages
// the server still renders - is SvelteKit's, except the product's pages when the server
// runs headless.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const OAUTH_HANDLER = Symbol.for('docket-cloud.oauth')

/**
 * Where the built web UI is: DOCKET_UI_DIR, else ui/ beside this file, where the server's build copies it
 * (scripts/copy-ui.mjs): its site in site/ and the module that serves it, serve.js.
 */
const UI_DIR = process.env.DOCKET_UI_DIR ?? fileURLToPath(new URL('./ui', import.meta.url))
const serving = existsSync(join(UI_DIR, 'serve.js')) ? await import(pathToFileURL(join(UI_DIR, 'serve.js')).href) : null

/**
 * The product's pages, which a headless server (`--no-ui`) does not serve: the home page and
 * everything under an account, account creation and the platform admin's pages. The API,
 * MCP, OAuth (with its consent screen), sign-in, the GitHub callbacks and health stay.
 */
export function isProductPage(pathname) {
  return pathname === '/' || /^\/(o|orgs|admin|_ui)(\/|$)/.test(pathname) || pathname === '/github/setup'
}

/** The built web UI (`UI_DIR`), or null when there is none: then its pages are not found, and the server says so. */
export function loadWebUi(options = {}) {
  return serving?.webUi(join(UI_DIR, 'site'), options) ?? null
}

/** The CSP's `frame-ancestors` for the UI's page: as the server's pages have it (runtime.ts validates DOCKET_FRAME_ANCESTORS at start). */
const frameAncestors = () => (process.env.DOCKET_FRAME_ANCESTORS ?? '').trim().split(/\s+/).filter(Boolean).join(' ') || "'none'"

/**
 * `(req, res)` for `http.createServer`: the OAuth provider's endpoints, then the web UI's
 * addresses, then SvelteKit's `handler`. `origin` is the public origin the provider builds its
 * URLs from, never a request's Host or X-Forwarded-* headers. With `ui: false` the product's
 * pages (the web UI's among them) are 404s. `web` is the built web UI (`loadWebUi`).
 */
export function frontListener({ handler, origin, ui = true, web = ui ? loadWebUi({ frameAncestors: frameAncestors() }) : null }) {
  const publicOrigin = new URL(origin)
  if (ui && !web) console.error(`No built web UI at ${UI_DIR}: its pages are not found. Build it with \`pnpm build\` at the repository root.`)
  return (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    const oauth = globalThis[OAUTH_HANDLER]
    if (oauth?.handles(pathname)) {
      // The provider trusts these (proxy mode): set them from the origin, whatever the client sent.
      req.headers.host = publicOrigin.host
      req.headers['x-forwarded-proto'] = publicOrigin.protocol.replace(/:$/, '')
      delete req.headers['x-forwarded-host']
      delete req.headers['x-forwarded-port']
      oauth.callback(req, res)
      return
    }
    if (!ui && isProductPage(pathname)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found: this server runs headless (no UI); its API is at /api and MCP at /mcp.')
      return
    }
    if (web?.handles(pathname)) {
      web.serve(req, res)
      return
    }
    handler(req, res, () => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
    })
  }
}
