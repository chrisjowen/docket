// Bundles the built private workspace packages docket ships with into
// dist/bundled/<directory>, each as a package (package.json + dist), and points
// every import of them at those copies, so the published package depends on
// none of them:
//
// - @docket/contracts and @docket/adapter-kit, which core imports;
// - the adapter packages v1 projections are served by, which core loads as
//   adapter modules and never imports. DOCKET_BUNDLED_ADAPTERS picks which
//   (comma-separated: jsonl,neo4j,mem0 - all by default); set it empty for a
//   minimal core. The adapter packages are not published, so a build that
//   leaves one out cannot serve projects that configure it.
//
// Fails rather than ship a package that still imports a workspace package.
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const packages = fileURLToPath(new URL('../../', import.meta.url))
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const bundledRoot = join(dist, 'bundled')

const ADAPTERS = ['jsonl', 'neo4j', 'mem0']
const selected = process.env.DOCKET_BUNDLED_ADAPTERS
const adapters = selected === undefined ? ADAPTERS : selected.split(',').map((name) => name.trim()).filter(Boolean)
for (const adapter of adapters) {
  if (!ADAPTERS.includes(adapter)) {
    console.error(`DOCKET_BUNDLED_ADAPTERS names "${adapter}"; docket ships ${ADAPTERS.join(', ')}.`)
    process.exit(1)
  }
}

const { version } = JSON.parse(await readFile(join(packages, 'docket', 'package.json'), 'utf8'))
const directories = ['contracts', 'adapter-kit', ...adapters.map((adapter) => `adapter-${adapter}`)]

/** Test helpers stay in the workspace. */
const shipped = (source) => !/[\\/](testing|[^\\/]+\.test)\.[^\\/]*$/.test(source)

/** name -> { directory, exports } of every bundled package. */
const bundled = new Map()
for (const directory of directories) {
  const from = join(packages, directory)
  const manifest = JSON.parse(await readFile(join(from, 'package.json'), 'utf8'))
  if (!existsSync(join(from, 'dist', 'index.js'))) {
    console.error(
      `No built ${manifest.name} at ${join(from, 'dist')}. Build the workspace with \`pnpm build\` at the repository root, ` +
        `or \`pnpm -C packages/${directory} build\` first.`
    )
    process.exit(1)
  }

  const to = join(bundledRoot, directory)
  await cp(join(from, 'dist'), join(to, 'dist'), { recursive: true, filter: shipped })
  const exports = Object.fromEntries(Object.entries(manifest.exports).filter(([subpath]) => subpath !== './testing'))
  // Versioned as the docket it ships in, which is what an adapter reports.
  await writeFile(
    join(to, 'package.json'),
    `${JSON.stringify({ name: manifest.name, version, private: true, type: manifest.type, exports }, null, 2)}\n`
  )
  bundled.set(manifest.name, { directory: to, exports })
}

/** The file an import of `name` + `subpath` loads, from the bundled copy. */
const entryOf = (name, subpath) => {
  const target = bundled.get(name)?.exports[subpath]
  const file = typeof target === 'string' ? target : target?.import
  return file === undefined ? undefined : join(bundled.get(name).directory, file)
}

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (/\.(js|d\.ts)$/.test(entry.name)) yield path
  }
}

// Import and export specifiers only: `from '…'`, `import '…'` and
// `import('…')`. A package name held as a string - the module a v1 projection
// type loads - must stay a package name.
const imported = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(@docket\/[^/'"]+)(\/[^'"]*)?\2/g
const leftovers = []
for await (const file of files(dist)) {
  const source = await readFile(file, 'utf8')
  if (!source.includes('@docket/')) continue
  const rewritten = source.replace(imported, (match, keyword, quote, name, rest) => {
    const entry = entryOf(name, rest === undefined ? '.' : `.${rest}`)
    if (entry === undefined) return match
    let target = relative(dirname(file), entry).split(sep).join('/')
    if (!target.startsWith('.')) target = `./${target}`
    return `${keyword}${quote}${target}${quote}`
  })
  if ([...rewritten.matchAll(imported)].length > 0) leftovers.push(file)
  await writeFile(file, rewritten)
}

if (leftovers.length > 0) {
  console.error(`dist still imports a workspace package in:\n${leftovers.join('\n')}`)
  process.exit(1)
}
