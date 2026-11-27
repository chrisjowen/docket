// SPDX-License-Identifier: AGPL-3.0-only
// The web UI's build boundary: what its pages, and the server's client modules
// they draw on, may import. The UI is a client of the public API, so nothing
// that runs only on the server - its request handlers, its database, its keys,
// its environment - may reach this build. A build that tries fails, naming
// the import and who made it.
import { builtinModules } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PLATFORM_APP = join(here, '..', '..', '..', 'platform', 'apps', 'server')

/** The server's `src/lib`: the components and client modules both apps draw while pages move here (`$platform`). */
export const PLATFORM_LIB = join(PLATFORM_APP, 'src', 'lib')
export const PLATFORM_STATIC = join(PLATFORM_APP, 'static')
export const SRC = join(here, 'src')
const OWN_LIB = join(SRC, 'lib')

/** Packages the UI may import, by name or name prefix (`d3-` is every d3 module). */
const PACKAGES = ['svelte', '@sveltejs/kit', '@lucide/svelte', '@fontsource/', '@fontsource-variable/', 'd3-', 'clsx']
/**
 * The Docket modules that are client-safe - plain data, schemas and functions, no database or Node: the public
 * API's definition, which the UI calls by, and the capability vocabulary.
 */
const CLIENT_MODULES = ['@docket/api', '@docket/platform-tenancy/roles']
/** SvelteKit's modules that exist only on the server. */
const SERVER_VIRTUAL = ['$env/static/private', '$env/dynamic/private', '$app/server']
/** Where the server keeps what runs only on the server, under its app. */
const SERVER_PATHS = [join(PLATFORM_LIB, 'server'), join(PLATFORM_APP, 'src', 'routes'), join(PLATFORM_APP, 'src', 'hooks.server.ts')]

const NODE = new Set(builtinModules)
/** A module id without its query (`?svelte&type=style`). @param {string} id */
const file = (id) => id.split('?')[0] ?? id
/** @param {string} path @param {string} dir */
const inside = (path, dir) => path === dir || path.startsWith(dir + sep)

/**
 * Whether an import is ours to judge: made by the UI's own source or a server module it draws on, not a package's internals.
 * @param {string | undefined} importer
 */
export function judged(importer) {
  if (!importer) return false
  const path = file(importer)
  // Tests run in Node and are never part of the build.
  if (/\.test\.[jt]s$/.test(path)) return false
  return !path.includes(`${sep}node_modules${sep}`) && (inside(path, SRC) || inside(path, PLATFORM_LIB))
}

/**
 * Why `source`, imported by `importer`, may not be in the UI (null when it may). `resolved`, when known, is the
 * file it resolved to.
 * @param {string} source
 * @param {string | undefined} importer
 * @param {string | null} [resolved]
 * @returns {string | null}
 */
export function refusal(source, importer, resolved = null) {
  if (!judged(importer)) return null
  const target = resolved ? file(resolved) : null
  if (source.startsWith('node:') || NODE.has(source) || NODE.has(source.split('/')[0] ?? source)) return 'a Node module'
  if (SERVER_VIRTUAL.includes(source)) return 'a SvelteKit module that exists only on the server'
  if (source === '$lib/server' || source.startsWith('$lib/server/') || source.startsWith('$platform/server')) return "the server's own code"
  if (/\.server(\.[a-z]+)?$/.test(source) || (target && /\.server\.[a-z]+$/.test(target))) return 'a server-only module'
  if (target && (SERVER_PATHS.some((dir) => inside(target, dir)) || inside(target, join(OWN_LIB, 'server')))) return "the server's own code"
  const bare = !/^[./$]/.test(source) && !source.startsWith('/') && !source.startsWith('\0') && !source.startsWith('virtual:')
  if (bare) {
    if (source.startsWith('@docket/') || source.startsWith('@chrisjowen/')) {
      return CLIENT_MODULES.includes(source) ? null : `a server package (only ${CLIENT_MODULES.join(' and ')} are client-safe)`
    }
    if (source.startsWith('@sveltejs/kit/node')) return "SvelteKit's Node adapter"
    if (!PACKAGES.some((allowed) => (/[/-]$/.test(allowed) ? source.startsWith(allowed) : source === allowed || source.startsWith(`${allowed}/`)))) {
      return 'a package the UI does not allow (boundary.js lists the ones it does)'
    }
  }
  return null
}

/** @param {string} path */
const shown = (path) => relative(join(here, '..', '..', '..'), file(path))

/**
 * The Vite plugin: resolves `$lib/...` in the server's modules to the server's `src/lib` (each app's `$lib` is its
 * own), and fails the build on an import `refusal` refuses.
 * @returns {import('vite').Plugin}
 */
export function boundary() {
  return {
    name: 'docket-ui-boundary',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !judged(importer)) return null
      const early = refusal(source, importer)
      const named = source.startsWith('/') ? shown(source) : source
      if (early) this.error(`${shown(importer)} imports ${named}: ${early}, which the web UI may not import.`)
      // Vite's alias has already made a server module's `$lib/...` this app's `src/lib/...`: it means the server's.
      const fromPlatform = inside(file(importer), PLATFORM_LIB) && inside(source, OWN_LIB)
      const target = fromPlatform ? join(PLATFORM_LIB, relative(OWN_LIB, source)) : source
      const resolved = await this.resolve(target, importer, { ...options, skipSelf: true })
      if (resolved && !resolved.external) {
        const late = refusal(source, importer, resolved.id)
        if (late) this.error(`${shown(importer)} imports ${named} (${shown(resolved.id)}): ${late}, which the web UI may not import.`)
      }
      return fromPlatform ? resolved : null
    }
  }
}
