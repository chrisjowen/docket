// SPDX-License-Identifier: AGPL-3.0-only
// The request listener in front of SvelteKit's handler, shared by server.js (the image's
// entry) and runtime.js (docket serve and docket open):
//
// MCP clients post to /oauth/token and /oauth/revoke as forms without an Origin header,
// which SvelteKit refuses as a cross-site form submission before any hook runs, so
// those endpoints (oidc-provider, made by the app's runtime at start) answer here.
// Everything else - the consent page included - is SvelteKit's, except the product's
// pages when the server runs headless.

const OAUTH_HANDLER = Symbol.for('docket-cloud.oauth')

/**
 * The product's pages, which a headless server (`--no-ui`) does not serve: the home page and
 * everything under an account, account creation and the platform admin's pages. The API,
 * MCP, OAuth (with its consent screen), sign-in, the GitHub callbacks and health stay.
 */
export function isProductPage(pathname) {
  return pathname === '/' || /^\/(o|orgs|admin)(\/|$)/.test(pathname) || pathname === '/github/setup'
}

/**
 * `(req, res)` for `http.createServer`: the OAuth provider's endpoints, then SvelteKit's
 * `handler`. `origin` is the public origin the provider builds its URLs from, never a
 * request's Host or X-Forwarded-* headers. With `ui: false` the product's pages are 404s.
 */
export function frontListener({ handler, origin, ui = true }) {
  const publicOrigin = new URL(origin)
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
    handler(req, res, () => {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
    })
  }
}
