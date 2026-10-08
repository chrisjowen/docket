import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  adapterManifestPath,
  Checkpoint,
  checkpointOf,
  emptyRecords,
  listAdapterManifests,
  readAdapterManifest,
  writeAdapterManifest,
  type AdapterManifest
} from './adapter-manifest.js'

const manifest = (overrides: Partial<AdapterManifest> = {}): AdapterManifest => {
  const records = {
    ...emptyRecords(),
    entity: { 'service.orders': { revision: 'sha256:1' }, 'team.payments': { revision: 'sha256:2' } },
    document: { '.docket/a.md': { revision: 'sha256:a', owner: 'service.orders' } }
  }
  return {
    version: 2,
    adapter: 'local',
    fingerprint: 'sha256:config',
    scope: 'default',
    definition: { name: 'jsonl', version: '0.4.0' },
    inputs: ['entity', 'document'],
    checkpoint: checkpointOf(records),
    owners: { 'team.payments': ['.docket/c.md'], 'service.orders': ['.docket/a.md'] },
    records,
    ...overrides
  }
}

describe('adapter manifests', () => {
  it('round-trip, one file per instance, in the same bytes whatever order they were built in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memory-adapter-manifest-'))
    await writeAdapterManifest(dir, manifest())
    const bytes = await readFile(adapterManifestPath(dir, 'local'), 'utf8')

    const reordered = manifest()
    reordered.records.entity = { 'team.payments': { revision: 'sha256:2' }, 'service.orders': { revision: 'sha256:1' } }
    await writeAdapterManifest(dir, reordered)

    expect(await readFile(adapterManifestPath(dir, 'local'), 'utf8')).toBe(bytes)
    expect(await readAdapterManifest(dir, 'local')).toEqual(manifest())
    expect(await listAdapterManifests(dir)).toEqual(['local'])
    expect(bytes).not.toMatch(/"(at|time|batchId)"/)
  })

  it('reads an absent, unreadable or other-version manifest as none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memory-adapter-manifest-'))
    expect(await readAdapterManifest(dir, 'local')).toBeUndefined()
    await writeAdapterManifest(dir, manifest())
    for (const contents of ['{ broken', JSON.stringify({ ...manifest(), version: 1 }), JSON.stringify({ ...manifest(), records: [] })]) {
      await writeFile(adapterManifestPath(dir, 'local'), contents, 'utf8')
      expect(await readAdapterManifest(dir, 'local')).toBeUndefined()
    }
  })

  it('identifies a set of records by its checkpoint, however it was reached', () => {
    const stepwise = new Checkpoint()
    stepwise.add('entity', 'team.payments', 'sha256:2')
    stepwise.add('entity', 'service.orders', 'sha256:0')
    stepwise.add('document', '.docket/a.md', 'sha256:a')
    stepwise.delete('entity', 'service.orders', 'sha256:0')
    stepwise.add('entity', 'service.orders', 'sha256:1')

    expect(stepwise.toString()).toBe(manifest().checkpoint)
    expect(checkpointOf(emptyRecords())).toBe(new Checkpoint().toString())
    expect(checkpointOf(emptyRecords())).not.toBe(manifest().checkpoint)
  })
})
