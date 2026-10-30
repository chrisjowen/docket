import { readFileSync } from 'node:fs'

import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

const { version } = JSON.parse(readFileSync(new URL('../docket/package.json', import.meta.url), 'utf8'))

/**
 * A single-page app: `docket open` serves `build/` as static files next to its
 * JSON API, so there is no server-side rendering and one fallback page.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: true }),
    // Relative asset paths, so the build works from whatever path it is served at.
    paths: { relative: true },
    // The docket it ships in, not the build's time, so the same sources build
    // the same files: docket's Wheelhouse plugin commits a copy and checks it.
    version: { name: version }
  }
}

export default config
