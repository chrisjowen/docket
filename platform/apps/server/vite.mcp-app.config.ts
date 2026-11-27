// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from 'node:path'

import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'

/**
 * Writes the app as the one HTML page an MCP host reads as its `ui://`
 * resource: the script inlined, its styles and faces inlined in the script,
 * so the page needs nothing from the network. `</script` in the script is
 * escaped so it cannot end the element early.
 */
const singlePage = (): Plugin => ({
  name: 'docket-cloud-mcp-app-page',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((file) => file.type === 'chunk')
    const others = Object.values(bundle).filter((file) => file.type !== 'chunk')
    if (chunks.length !== 1 || others.length !== 0) {
      this.error(`The search app should build to one script, not ${Object.keys(bundle).join(', ')}.`)
    }
    const [chunk] = chunks
    if (!chunk || chunk.type !== 'chunk') return
    delete bundle[chunk.fileName]
    const script = chunk.code.replace(/<\/script/gi, '<\\/script')
    this.emitFile({
      type: 'asset',
      fileName: 'search.html',
      source: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Docket Cloud search</title>
</head>
<body>
<script>${script}</script>
</body>
</html>
`,
    })
  },
})

/**
 * docket_search's MCP app as Docket Cloud returns it (src/mcp-app), built
 * after the web app to `build/mcp-app/search.html`; server.js hands that path
 * to the MCP endpoint (DOCKET_MCP_APP), which serves it in place of docket's own.
 */
export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess(), compilerOptions: { css: 'injected' } }), singlePage()],
  resolve: { alias: { $lib: resolve(import.meta.dirname, 'src/lib') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: resolve(import.meta.dirname, 'src/mcp-app/main.svelte.ts'), formats: ['iife'], name: 'docketCloudSearch', fileName: () => 'search.js' },
    outDir: 'build/mcp-app',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    reportCompressedSize: false,
  },
})
