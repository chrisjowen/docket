/**
 * Builds docket's Wheelhouse plugin: bundles src/server.ts into
 * server/index.js with esbuild, docket-ui's casebook element
 * (packages/docket-ui/src/embed, through its vite.embed.config.ts) into
 * ui/index.js, and copies the built docket CLI (packages/docket/dist) into
 * docket/, the docket the plugin runs. Wheelhouse installs and updates a
 * plugin by fetching its repository, with no install or build step, so the
 * built files are committed, each with its dependencies inlined.
 *
 *   pnpm build    write them
 *   pnpm check    fail when they differ from what the sources build
 *
 * docket/ is copied from packages/docket/dist, so build the workspace first
 * (`pnpm build` at the repository root).
 */
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { build as esbuild } from 'esbuild'
import { build as vite } from 'vite'

const here = import.meta.dirname
const ui = path.join(here, '..', 'packages', 'docket-ui')
const docket = path.join(here, '..', 'packages', 'docket')
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
  return new Map([['server/index.js', result.outputFiles[0].text]])
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
  return new Map([['ui/index.js', chunks[0].code]])
}

/** Every file under `dir`, relative to it, in a stable order. */
const walk = (dir, prefix = '') =>
  readdirSync(path.join(dir, prefix), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? walk(dir, rel) : [rel]
    })

/** `from '<spec>'`, `import '<spec>'` and `import('<spec>')`: what the specifier rewrite and check read. */
const SPECIFIER = /(?<![\w$.'"])(from\s*|import\s*\(?\s*)(['"])([^'"]+)\2/g
/** An import or re-export with a clause, whose names a vendored module must export. */
const CLAUSE = /(?<![\w$.'"])(import|export)\s+([^'";]*?)\s*from\s*(['"])([^'"]+)\3/g
/** A specifier that names a package, as opposed to text that happens to follow `from` in a string. */
const PACKAGE = /^(@[\w.-]+\/)?[\w-][\w.-]*(\/[\w.-]+)*$/

const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

/** The names each import of `spec` takes: `default` and the named ones; refuses a form it cannot vendor. */
const namesImported = (clause, kind, spec, file) => {
  const names = []
  let rest = clause.trim()
  const refuse = () => {
    throw new Error(`${file} imports ${spec} as \`${kind} ${clause} from\`, which wheelhouse/build.mjs does not vendor yet.`)
  }
  if (kind === 'export' || rest.startsWith('*')) {
    if (!rest.startsWith('{')) refuse()
  } else if (!rest.startsWith('{')) {
    const [first, ...others] = rest.split(',')
    if (!/^[\w$]+$/.test(first.trim())) refuse()
    names.push('default')
    rest = others.join(',').trim()
  }
  if (rest) {
    const braces = /^\{([^}]*)\}$/.exec(rest)
    if (!braces) refuse()
    for (const part of braces[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
      if (name) names.push(name)
    }
  }
  return names
}

/**
 * The docket the plugin runs: packages/docket/dist as it is published - the
 * CLI, the web UI docket open serves, docket_search's app, the ontologies and
 * the adapters it ships - with no source maps or type declarations, and the
 * npm packages it imports bundled into dist/vendor/, since nothing installs
 * them. docket's optional drivers (its peer dependencies) stay imports, as
 * they are for docket installed from npm.
 */
const shippedDocket = async () => {
  const dist = path.join(docket, 'dist')
  if (!existsSync(path.join(dist, 'cli.js')) || !existsSync(path.join(dist, 'ui', 'index.html'))) {
    throw new Error(`No built docket at ${dist}. Build the workspace with \`pnpm build\` at the repository root first.`)
  }
  const manifest = JSON.parse(readFileSync(path.join(docket, 'package.json'), 'utf8'))
  const vendored = new Set(Object.keys(manifest.dependencies ?? {}))
  const peers = new Set(Object.keys(manifest.peerDependencies ?? {}))
  const vendorFile = (spec) => `vendor/${spec.replace(/^@/, '').replace(/\//g, '__')}.js`

  const files = new Map()
  /** spec -> the names imported from it. */
  const imports = new Map()
  for (const rel of walk(dist)) {
    if (rel.endsWith('.map') || rel.endsWith('.d.ts')) continue
    const out = `docket/dist/${rel}`
    const isCode = rel.endsWith('.js') && !rel.startsWith('ui/') && !rel.startsWith('mcp-app/')
    if (!isCode) {
      files.set(out, readFileSync(path.join(dist, rel)))
      continue
    }
    let source = readFileSync(path.join(dist, rel), 'utf8').replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n')
    for (const [, kind, clause, , spec] of source.matchAll(CLAUSE)) {
      if (!vendored.has(spec)) continue
      const names = imports.get(spec) ?? new Set()
      for (const name of namesImported(clause, kind, spec, rel)) names.add(name)
      imports.set(spec, names)
    }
    source = source.replace(SPECIFIER, (match, keyword, quote, spec) => {
      if (!PACKAGE.test(spec) || isBuiltin(spec) || peers.has(packageOf(spec))) return match
      if (!vendored.has(spec)) {
        throw new Error(`${rel} imports ${spec}, which is neither one of docket's dependencies nor one of its optional drivers.`)
      }
      if (!imports.has(spec)) throw new Error(`${rel} imports ${spec} in a form wheelhouse/build.mjs does not vendor yet.`)
      let target = path.posix.relative(path.posix.dirname(rel), vendorFile(spec))
      if (!target.startsWith('.')) target = `./${target}`
      return `${keyword}${quote}${target}${quote}`
    })
    files.set(out, source)
  }

  for (const [spec, names] of [...imports].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const named = [...names].filter((name) => name !== 'default').sort()
    const contents = [
      names.has('default') ? `export { default } from '${spec}'` : '',
      named.length ? `export { ${named.join(', ')} } from '${spec}'` : ''
    ].join('\n')
    const result = await esbuild({
      stdin: { contents, resolveDir: docket, sourcefile: `${spec}.js`, loader: 'js' },
      absWorkingDir: here,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      // Third-party code nobody reads here; its licences are kept.
      minify: true,
      legalComments: 'eof',
      // A CommonJS package bundled as a module still requires node's own modules.
      banner: { js: `${BANNER}\nimport { createRequire as __docketCreateRequire } from 'node:module';\nconst require = __docketCreateRequire(import.meta.url);` },
      write: false,
      logLevel: 'warning'
    })
    files.set(`docket/dist/${vendorFile(spec)}`, result.outputFiles[0].text)
  }

  // What the CLI reads about itself (its version, its optional drivers), and
  // that its files are modules.
  const shipped = {
    name: manifest.name,
    version: manifest.version,
    private: true,
    description: `docket ${manifest.version}, as docket's Wheelhouse plugin ships and runs it. Built by wheelhouse/build.mjs from packages/docket; do not edit.`,
    type: manifest.type,
    engines: manifest.engines,
    peerDependencies: manifest.peerDependencies,
    peerDependenciesMeta: manifest.peerDependenciesMeta
  }
  files.set('docket/package.json', `${JSON.stringify(shipped, null, 2)}\n`)
  return files
}

const targets = [
  { dir: null, build: server },
  { dir: null, build: element },
  { dir: 'docket', build: shippedDocket }
]

const same = (a, b) => (typeof a === 'string' ? a === b.toString('utf8') : a.equals(b))

const check = process.argv.includes('--check')
let stale = 0
for (const target of targets) {
  const files = await target.build()
  if (check) {
    const expected = new Set(files.keys())
    for (const [rel, content] of files) {
      const out = path.join(here, rel)
      if (!existsSync(out) || !same(content, readFileSync(out))) {
        console.error(`wheelhouse/${rel} is out of date; run pnpm build in wheelhouse/.`)
        stale++
      }
    }
    if (target.dir && existsSync(path.join(here, target.dir))) {
      for (const rel of walk(path.join(here, target.dir))) {
        if (!expected.has(`${target.dir}/${rel}`)) {
          console.error(`wheelhouse/${target.dir}/${rel} is not built from the sources; run pnpm build in wheelhouse/.`)
          stale++
        }
      }
    }
  } else {
    if (target.dir) rmSync(path.join(here, target.dir), { recursive: true, force: true })
    let bytes = 0
    for (const [rel, content] of files) {
      const out = path.join(here, rel)
      mkdirSync(path.dirname(out), { recursive: true })
      writeFileSync(out, content)
      bytes += content.length
    }
    const label = target.dir ? `${target.dir}/ (${files.size} files)` : [...files.keys()][0]
    console.log(`${label}  ${(bytes / 1024).toFixed(1)} KiB`)
  }
}
if (stale) process.exit(1)
