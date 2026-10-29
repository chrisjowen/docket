/**
 * Builds docket's Wheelhouse plugin: bundles src/server.ts into
 * server/index.js with esbuild, and docket-ui's casebook element
 * (packages/docket-ui/src/embed, through its vite.embed.config.ts) into
 * ui/index.js. Each is one ES module with its dependencies inlined, since
 * Wheelhouse imports them as they are, with no install or build step, so the
 * built files are committed.
 *
 *   pnpm build    write them
 *   pnpm check    fail when they differ from what the sources build
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build as esbuild } from 'esbuild'
import { build as vite } from 'vite'

const here = import.meta.dirname
const ui = path.join(here, '..', 'packages', 'docket-ui')
const BANNER = '// Built by wheelhouse/build.mjs; do not edit. Run `pnpm build` in wheelhouse/.'

const server = async () => {
  const result = await esbuild({
    entryPoints: [path.join(here, 'src', 'server.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    legalComments: 'eof',
    banner: { js: BANNER },
    write: false,
    logLevel: 'warning'
  })
  return result.outputFiles[0].text
}

const element = async () => {
  const [output] = /** @type {import('vite').Rollup.RollupOutput[]} */ (
    await vite({
      root: ui,
      configFile: path.join(ui, 'vite.embed.config.ts'),
      logLevel: 'warn',
      build: { write: false, rollupOptions: { output: { banner: BANNER } } }
    })
  )
  const chunks = output.output.filter((file) => file.type === 'chunk')
  const assets = output.output.filter((file) => file.type === 'asset')
  if (chunks.length !== 1 || assets.length !== 0) {
    throw new Error(`The casebook element should build to one file, not ${output.output.map((file) => file.fileName).join(', ')}.`)
  }
  return chunks[0].code
}

const targets = [
  { out: 'server/index.js', build: server },
  { out: 'ui/index.js', build: element }
]

const check = process.argv.includes('--check')
let stale = 0
for (const target of targets) {
  const text = await target.build()
  const out = path.join(here, target.out)
  if (check) {
    let current = null
    try {
      current = readFileSync(out, 'utf8')
    } catch {
      // Missing counts as out of date.
    }
    if (current !== text) {
      console.error(`wheelhouse/${target.out} is out of date; run pnpm build in wheelhouse/.`)
      stale++
    }
  } else {
    writeFileSync(out, text)
    console.log(`${target.out}  ${(text.length / 1024).toFixed(1)} KiB`)
  }
}
if (stale) process.exit(1)
