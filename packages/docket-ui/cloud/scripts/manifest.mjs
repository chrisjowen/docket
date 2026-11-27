// SPDX-License-Identifier: AGPL-3.0-only
// Writes build/_ui/manifest.json beside the built UI: its name and version, the API version it was built for,
// and the addresses it draws, as patterns. The server serves the UI at those addresses and leaves every
// other one to its own pages (apps/server/front.js); a host serving the UI on its own does the same
// (standalone.mjs). Its routes are read from src/routes, so the list is never kept by hand.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const routes = join(root, 'src', 'routes')
const build = join(root, 'build')
if (!existsSync(join(build, 'index.html'))) {
  console.error('manifest: no build/index.html; run `vite build` first')
  process.exit(1)
}

const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// The API version the UI was built against: @docket/api's, which every /api/v1 answer carries.
const operations = readFileSync(join(root, '..', '..', 'api', 'src', 'operations.ts'), 'utf8')
const api = /export const API_VERSION = '([^']+)'/.exec(operations)?.[1]
if (!api) throw new Error('manifest: no API_VERSION in @docket/api')

/** Every page's route id: a directory under src/routes with a +page.svelte, groups `(name)` left out. */
const pages = readdirSync(routes, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name === '+page.svelte')
  .map((entry) => `/${relative(routes, entry.parentPath).split(sep).filter((part) => part && !/^\(.*\)$/.test(part)).join('/')}`)
  .sort()

const manifest = { name, version, api, routes: pages }
writeFileSync(join(build, '_ui', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`manifest: ${name}@${version} for API ${api}, ${pages.length} pages: ${pages.join(' ')}`)
