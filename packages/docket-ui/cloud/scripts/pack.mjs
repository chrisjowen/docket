// SPDX-License-Identifier: AGPL-3.0-only
// Packs the built web UI as a versioned artifact for hosting on its own:
// dist/docket-cloud-ui-<version>.tgz, holding site/ (the same files the server bundles), serve.js,
// standalone.mjs, the manifest (its version and the API version it needs), the README and the licence.
// Prints its size. The release attaches it beside the server's packages.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifestFile = join(root, 'build', '_ui', 'manifest.json')
if (!existsSync(manifestFile)) {
  console.error('pack: no build; run `pnpm build` first')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const name = `docket-cloud-ui-${manifest.version}`
const dist = join(root, 'dist')
const stage = join(dist, name)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(join(root, 'build'), join(stage, 'site'), { recursive: true })
for (const file of ['serve.js', 'standalone.mjs', 'README.md', 'LICENSE']) cpSync(join(root, file), join(stage, file))
writeFileSync(join(stage, 'package.json'), `${JSON.stringify({ name: manifest.name, version: manifest.version, private: true, license: 'AGPL-3.0-only', type: 'module', docketApi: manifest.api, bin: { 'docket-cloud-ui': 'standalone.mjs' } }, null, 2)}\n`)
const tarball = join(dist, `${name}.tgz`)
execFileSync('tar', ['-czf', tarball, '-C', dist, name])
rmSync(stage, { recursive: true, force: true })
console.log(`pack: ${tarball} (${(statSync(tarball).size / 1024).toFixed(1)} KiB) for Docket API ${manifest.api}`)
