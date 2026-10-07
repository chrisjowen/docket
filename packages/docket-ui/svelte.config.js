import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/**
 * A single-page app: `docket open` serves `build/` as static files next to its
 * JSON API, so there is no server-side rendering and one fallback page.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: true }),
    // Relative asset paths, so the build works from whatever path it is served at.
    paths: { relative: true }
  }
}

export default config
