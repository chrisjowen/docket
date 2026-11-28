// SPDX-License-Identifier: AGPL-3.0-only
// Serves the built web UI: its files under /_ui/, its favicon, and its one page
// at every address it draws (build/_ui/manifest.json's routes). Dependency-free
// Node, shared by the server that bundles the UI (platform/apps/server/front.js,
// which carries a copy) and the host that serves it on its own (standalone.mjs).
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

/** A route id's pattern: `[name]` is one path segment, `[...name]` any number of them. */
export function routePattern(route) {
  const body = route
    .split('/')
    .filter(Boolean)
    .map((part) => (/^\[\.\.\.\w+\]$/.test(part) ? '.*' : part.replace(/\[\w+\]/g, '[^/]+').replace(/[.()]/g, '\\$&')))
    .join('/')
  return new RegExp(`^/${body}/?$`)
}

/** Whether a UI built for API `wanted` can use a server answering `served`: the same major, no newer minor. */
export function compatible(wanted, served) {
  const [wantMajor, wantMinor] = String(wanted).split('.').map(Number)
  const [haveMajor, haveMinor] = String(served).split('.').map(Number)
  return wantMajor === haveMajor && (wantMinor ?? 0) <= (haveMinor ?? 0)
}

/** The headers the page goes with. Its own CSP (a `<meta>`, with its script's hash) cannot say who may frame it. */
const pageHeaders = (frameAncestors) => ({
  'content-type': TYPES['.html'],
  'cache-control': 'no-cache',
  'content-security-policy': `frame-ancestors ${frameAncestors}`,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
})

/**
 * The UI built in `dir` (`index.html`, `_ui/`, `_ui/manifest.json`), or null when there is none there. `handles`
 * says whether an address is the UI's; `serve` answers it. `frameAncestors` is the CSP's `frame-ancestors`.
 */
export function webUi(dir, { frameAncestors = "'none'" } = {}) {
  const index = join(dir, 'index.html')
  const manifestFile = join(dir, '_ui', 'manifest.json')
  if (!existsSync(index) || !existsSync(manifestFile)) return null
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  const page = readFileSync(index)
  const routes = manifest.routes.map(routePattern)
  // Top-level files the build carries (its favicon), served at their own addresses.
  const loose = new Set(readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name !== 'index.html').map((entry) => `/${entry.name}`))

  const isAsset = (pathname) => pathname.startsWith('/_ui/') || loose.has(pathname)
  const isPage = (pathname) => routes.some((pattern) => pattern.test(pathname))

  const root = normalize(dir.endsWith(sep) ? dir : dir + sep)
  const decoded = (pathname) => {
    try {
      return decodeURIComponent(pathname)
    } catch {
      return null
    }
  }

  function sendFile(req, res, pathname) {
    const name = decoded(pathname)
    const file = name === null ? null : normalize(join(dir, name))
    if (!file || !file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': TYPES['.txt'] }).end('Not found')
      return
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
      // Hashed names never change; the rest (the manifest, the favicon) is checked each time.
      'cache-control': pathname.startsWith('/_ui/immutable/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file).pipe(res)
  }

  return {
    manifest,
    /** Whether `pathname` is the UI's: one of its files, or a page it draws. */
    handles: (pathname) => isAsset(pathname) || isPage(pathname),
    serve(req, res) {
      const pathname = (req.url ?? '/').split('?')[0]
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD', 'content-type': TYPES['.txt'] }).end('This page is drawn in the browser; it takes GET only. Its changes go to /api/v1.')
        return
      }
      if (isAsset(pathname)) return sendFile(req, res, pathname)
      res.writeHead(200, { ...pageHeaders(frameAncestors), 'content-length': page.length })
      res.end(req.method === 'HEAD' ? undefined : page)
    },
  }
}
