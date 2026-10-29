import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * Tailwind gives its utilities' variables their starting values with
 * `@property`, which a shadow root ignores, and falls back to setting them on
 * every element only in browsers without `@property`. In the shadow root the
 * fallback is what works, so it is made unconditional. A Tailwind that no
 * longer writes the fallback this way fails the build rather than drawing
 * shadows and rings wrong.
 */
const FALLBACK = '@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b))))'
const shadowRootProperties = (): Plugin => ({
  name: 'docket-shadow-root-properties',
  renderChunk(code) {
    if (!code.includes(FALLBACK)) this.error('Tailwind no longer writes its @property fallback as the embed build expects.')
    return { code: code.replaceAll(FALLBACK, '@supports (display:block)'), map: null }
  }
})

/**
 * The casebook as a Wheelhouse plugin element: one ES module that defines
 * `<docket-casebook>` (src/embed/element.svelte.ts), with Svelte, the UI's
 * dependencies and its stylesheet inlined, since Wheelhouse imports the
 * bundle as it is. `pnpm build:embed` writes it to `embed/`; the Wheelhouse
 * plugin's build (wheelhouse/build.mjs at the repository root) writes it to
 * `wheelhouse/ui/index.js`, through `outDir`.
 */
export default defineConfig({
  // Components' own styles go into the shadow root they mount in, not a stylesheet beside the bundle.
  // Their scoping class hashes the styles rather than Svelte's default, the file's path, which is
  // absolute for files outside the working directory (dependencies), so the bundle would depend on
  // where the repository is checked out.
  plugins: [
    tailwindcss(),
    svelte({ compilerOptions: { css: 'injected', cssHash: ({ css, hash }) => `svelte-${hash(css)}` } }),
    shadowRootProperties()
  ],
  resolve: { alias: { $lib: resolve(import.meta.dirname, 'src/lib') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: { entry: resolve(import.meta.dirname, 'src/embed/element.svelte.ts'), formats: ['es'], fileName: () => 'index.js' },
    outDir: 'embed',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    reportCompressedSize: false,
    rollupOptions: {
      // zod's comments about esbuild's tree-shaking are notes to esbuild, not annotations Rollup can use.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/zod/')) return
        warn(warning)
      }
    }
  }
})
