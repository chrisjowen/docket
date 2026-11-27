// SPDX-License-Identifier: AGPL-3.0-only
import adapter from '@sveltejs/adapter-node'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/**
 * Extra origins a local preview build trusts for form posts, so it answers on
 * both http://127.0.0.1:<port> and http://localhost:<port>
 * (DOCKET_PREVIEW_ORIGINS at build time, as tests/e2e/serve.mjs documents).
 * Plain-HTTP loopback origins only: the production image is built without it,
 * and anything else fails the build.
 */
const previewOrigins = (process.env.DOCKET_PREVIEW_ORIGINS ?? '').split(/\s+/).filter(Boolean)
for (const origin of previewOrigins) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    throw new Error(`DOCKET_PREVIEW_ORIGINS lists loopback origins like http://localhost:4480, not ${origin}`)
  }
}

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csrf: { trustedOrigins: previewOrigins },
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'base-uri': ['self'],
        'frame-ancestors': ['none'],
        'form-action': ['self'],
        'object-src': ['none'],
        // The graph board positions and colours its marks with style attributes. Inline
        // scripts and <style> elements stay refused: only `style="..."` is allowed.
        'style-src-attr': ['unsafe-inline'],
      },
    },
  },
}
