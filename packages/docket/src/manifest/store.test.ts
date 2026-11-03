import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { memoryConfigSchema, stateRootOf, type ResolvedConfig } from '../config/config.js'
import { adapterManifestPath, checkpointOf, emptyRecords, writeAdapterManifest, type AdapterManifest } from './adapter-manifest.js'
import { loadAdapterManifests } from './state.js'
import { fileManifestStore, type ManifestStore } from './store.js'

const manifest = (adapter = 'local'): AdapterManifest => {
  const records = {
    ...emptyRecords(),
    entity: { 'service.orders': { revision: 'sha256:1' }, 'team.payments': { revision: 'sha256:2' } },
    document: { '.docket/a.md': { revision: 'sha256:a', owner: 'service.orders' } }
  }
  return {
    version: 2,
    adapter,
    fingerprint: 'sha256:config',
    scope: 'default',
    definition: { name: 'jsonl', version: '0.4.0' },
    inputs: ['entity', 'document'],
    checkpoint: checkpointOf(records),
    owners: { 'team.payments': ['.docket/c.md'], 'service.orders': ['.docket/a.md'] },
    records
  }
}

const project = async (): Promise<ResolvedConfig> => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'docket-manifest-store-'))
  return {
    config: memoryConfigSchema.parse({ version: 2 }),
    projectRoot,
    memoryRoot: join(projectRoot, '.docket'),
    ontologyPath: join(projectRoot, '.docket/entities.yaml')
  }
}

describe('fileManifestStore', () => {
  it('round-trips the manifest the current state.ts writes, a byte-identical file under the state root', async () => {
    const [written, stored] = await Promise.all([project(), project()])
    await writeAdapterManifest(stateRootOf(written), manifest())
    const store = fileManifestStore(stateRootOf(stored))
    await store.write('local', manifest())

    const file = adapterManifestPath(stateRootOf(stored), 'local')
    expect(file).toBe(join(stored.projectRoot, '.docket/.index/manifests/local.json'))
    expect(await readFile(file, 'utf8')).toBe(await readFile(adapterManifestPath(stateRootOf(written), 'local'), 'utf8'))
    expect(await store.read('local')).toEqual(manifest())
    expect(await store.read('other')).toBeUndefined()
  })

  it('lists the instances it holds a manifest for, and removes one', async () => {
    const store = fileManifestStore(stateRootOf(await project()))
    expect(await store.list()).toEqual([])
    await store.write('local', manifest())
    await store.write('graph', manifest('graph'))
    expect(await store.list()).toEqual(['graph', 'local'])

    await store.remove('graph')
    expect(await store.list()).toEqual(['local'])
    expect(await store.read('graph')).toBeUndefined()
  })
})

describe('loadAdapterManifests', () => {
  it('reads through the store it is given', async () => {
    const held = new Map([['local', manifest()]])
    const store: ManifestStore = {
      read: async (id) => held.get(id),
      write: async (id, written) => void held.set(id, written),
      list: async () => [...held.keys()],
      remove: async (id) => void held.delete(id)
    }

    const loaded = await loadAdapterManifests(
      await project(),
      [{ id: 'local', fingerprint: 'sha256:config', scope: 'default' }],
      { legacyFingerprint: 'none', configured: ['local'], store }
    )
    expect(loaded.get('local')).toEqual({ manifest: manifest(), origin: 'current', reset: false })
  })
})
