// Fetches the search evaluation's datasets (README.md) into the data
// directory, checking each against the sha256 in datasets.json. A file already
// there with the right hash is kept. Nothing large is committed to the repo.
//
//   node eval/search/download.mjs            every dataset
//   node eval/search/download.mjs wands      only the files of the named datasets
//
// DOCKET_EVAL_DATA   where to put them (default: $XDG_CACHE_HOME/docket-eval, or ~/.cache/docket-eval)
// DOCKET_EVAL_MIRROR a mirror to fetch <mirror>/<file> from instead of each upstream url
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const dataDir = () =>
  process.env.DOCKET_EVAL_DATA || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'docket-eval')

const manifest = JSON.parse(await readFile(new URL('./datasets.json', import.meta.url), 'utf8'))
const only = process.argv.slice(2)
const mirror = process.env.DOCKET_EVAL_MIRROR?.replace(/\/+$/, '')
const dir = dataDir()
await mkdir(dir, { recursive: true })

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

let failed = 0
for (const entry of manifest.files) {
  if (only.length > 0 && !only.includes(entry.dataset)) continue
  const target = join(dir, entry.file)
  if (existsSync(target) && sha256(await readFile(target)) === entry.sha256) {
    console.log(`ok       ${entry.file}`)
    continue
  }
  const url = mirror ? `${mirror}/${entry.file}` : entry.url
  process.stdout.write(`fetching ${entry.file} from ${url} ... `)
  const response = await fetch(url)
  if (!response.ok) {
    console.log(`failed: HTTP ${response.status}`)
    failed += 1
    continue
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== entry.sha256) {
    console.log(`failed: sha256 ${actual}, expected ${entry.sha256}`)
    failed += 1
    continue
  }
  await writeFile(`${target}.part`, bytes)
  await rename(`${target}.part`, target)
  console.log(`${(bytes.length / 1e6).toFixed(1)} MB (${entry.license})`)
}
console.log(`data directory: ${dir}`)
if (failed > 0) {
  console.error(`${failed} file(s) could not be fetched`)
  process.exitCode = 1
}
