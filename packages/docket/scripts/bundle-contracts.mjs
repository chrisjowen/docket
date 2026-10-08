// Bundles the built @docket/contracts into dist/contracts and points dist at it,
// so the published package does not depend on the private workspace package.
// Fails rather than ship a package that still imports @docket/contracts.
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const from = fileURLToPath(new URL('../../contracts/dist/', import.meta.url))
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const to = join(dist, 'contracts')
const specifier = '@docket/contracts'

if (!existsSync(join(from, 'index.js'))) {
  console.error(
    `No built contracts at ${from}. Build the workspace with \`pnpm build\` at the repository root, ` +
      'or `pnpm -C packages/contracts build` first.'
  )
  process.exit(1)
}

await cp(from, to, {
  recursive: true,
  filter: (source) => !/[\\/]testing\.[^\\/]*$/.test(source)
})

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path !== to) yield* files(path)
    } else if (/\.(js|d\.ts)$/.test(entry.name)) {
      yield path
    }
  }
}

const leftovers = []
for await (const file of files(dist)) {
  const source = await readFile(file, 'utf8')
  if (!source.includes(specifier)) continue
  let target = relative(dirname(file), join(to, 'index.js')).split(sep).join('/')
  if (!target.startsWith('.')) target = `./${target}`
  const rewritten = source.replace(/(['"])@docket\/contracts\1/g, `$1${target}$1`)
  if (rewritten.includes(specifier)) leftovers.push(file)
  await writeFile(file, rewritten)
}

if (leftovers.length > 0) {
  console.error(`dist still imports ${specifier} in:\n${leftovers.join('\n')}`)
  process.exit(1)
}
