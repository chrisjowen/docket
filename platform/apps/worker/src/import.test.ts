// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { FIXTURE_ROOT } from '@docket/platform-canonical-store/fixture'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseDocketTree, readDocketTree } from './import-docket.js'

const root = join(import.meta.dirname, '..')
const outDir = join(root, 'node_modules', '.import-test')

describe('import.js --pack', () => {
  let dir: string

  beforeAll(async () => {
    await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true, sourcemap: false } })
    dir = join(await mkdtemp(join(tmpdir(), 'import-pack-')), '.docket')
    await cp(join(FIXTURE_ROOT, '.docket'), dir, { recursive: true })
    await writeFile(join(dir, 'resources', 'service', 'big.md'), `---\nid: service.big\ntype: service\ntitle: Big\n---\n\n${'A long page. '.repeat(200_000)}\n`)
  }, 120_000)
  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
    if (dir) await rm(join(dir, '..'), { recursive: true, force: true })
  })

  it('prints the whole tree to a pipe that is read slowly, far past its buffer', async () => {
    const child = spawn(process.execPath, [join(outDir, 'import.js'), '--pack', dir], { stdio: ['ignore', 'pipe', 'inherit'] })
    const closed = new Promise<number | null>((done) => child.on('close', done))
    child.stdout.pause()
    await sleep(500)
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk)).resume()
    const code = await closed
    const packed = Buffer.concat(chunks).toString('utf8')
    expect(packed.length).toBeGreaterThan(2_000_000)
    expect(code).toBe(0)
    expect(parseDocketTree(packed)).toEqual(await readDocketTree(dir))
  })
})
