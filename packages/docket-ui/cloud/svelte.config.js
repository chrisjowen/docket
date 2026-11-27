// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'

import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

import { PLATFORM_LIB, PLATFORM_STATIC } from './boundary.js'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * The multi-tenant server's web UI: a single-page app with no server-side
 * rendering, one fallback page and its files under /_ui/, so the server can
 * serve it beside its own pages and API, and any static host can serve it on
 * its own (README.md). Its pages call the public API alone.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: true }),
    // Beside the server's own pages, which keep /_app/.
    appDir: '_ui',
    // The server's favicon, so both apps show the same one.
    files: { assets: PLATFORM_STATIC },
    // The components and client modules the server's pages still use: one copy, drawn by both apps while
    // the pages move here. vite.config.ts keeps their server-only modules out of this build (boundary.js).
    alias: { $platform: PLATFORM_LIB },
    version: { name: version },
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'object-src': ['none'],
        // The graph board positions and colours its marks with style attributes, as on the server's pages.
        'style-src-attr': ['unsafe-inline']
      }
    }
  }
}

export default config
