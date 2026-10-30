import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * Writes the app as the one HTML page an MCP host reads as its `ui://`
 * resource: the script inlined (its stylesheet is inlined in the script), so
 * the page needs nothing from the network. `</script` in the script is
 * escaped so it cannot end the element early.
 */
const singlePage = (): Plugin => ({
  name: 'docket-mcp-app-page',
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
<title>Docket search</title>
</head>
<body>
<script>${script}</script>
</body>
</html>
`
    })
  }
})

/**
 * docket_search's MCP app (src/mcp-app), built to `mcp-app/search.html`;
 * the docket package's build copies it to `dist/mcp-app/`, where
 * `docket open`'s MCP server reads it from.
 */
export default defineConfig({
  plugins: [tailwindcss(), svelte({ compilerOptions: { css: 'injected' } }), singlePage()],
  resolve: { alias: { $lib: resolve(import.meta.dirname, 'src/lib') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: resolve(import.meta.dirname, 'src/mcp-app/main.svelte.ts'), formats: ['iife'], name: 'docketSearch', fileName: () => 'search.js' },
    outDir: 'mcp-app',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    reportCompressedSize: false
  }
})
