import type { CanonicalInput } from '@docket/contracts'
import { fakeServices } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import { NativeOwnership, type NativeRecord, type NativeStore } from './native-ownership.js'
import { resolveNativeHits } from './recall-answer.js'
import { entityInput } from './testing.js'

/** An engine that keeps identities on its records, as memvid URIs and MemPalace source files do. */
class FakeStore implements NativeStore {
  readonly records = new Map<string, NativeRecord & { text: string }>()
  lists = 0
  writes = 0
  private next = 0

  async list(): Promise<NativeRecord[]> {
    this.lists += 1
    return [...this.records.values()].map(({ nativeId, identity }) => ({ nativeId, identity }))
  }
  async write(record: CanonicalInput): Promise<NativeRecord> {
    this.writes += 1
    const nativeId = `n${(this.next += 1)}`
    const stored = { nativeId, identity: { kind: record.kind, id: record.id, revision: record.revision }, text: record.id }
    this.records.set(nativeId, stored)
    return { nativeId, identity: stored.identity }
  }
  async delete(record: NativeRecord): Promise<void> {
    this.records.delete(record.nativeId)
  }
  revisions(id: string): string[] {
    return [...this.records.values()].filter((record) => record.identity.id === id).map((record) => record.identity.revision)
  }
}

describe('NativeOwnership', () => {
  it('writes a record once, however often the same revision is replayed', async () => {
    const store = new FakeStore()
    const ownership = new NativeOwnership(store)
    await ownership.upsert(entityInput({ id: 'service.a', revision: 'r1' }))
    await ownership.upsert(entityInput({ id: 'service.a', revision: 'r1' }))
    expect(store.writes).toBe(1)
    expect(store.revisions('service.a')).toEqual(['r1'])

    // A fresh instance - another process, after a restart - reads the mapping back from the engine.
    await new NativeOwnership(store).upsert(entityInput({ id: 'service.a', revision: 'r1' }))
    expect(store.writes).toBe(1)
  })

  it('replaces an earlier revision, leaving only the new one current', async () => {
    const store = new FakeStore()
    const ownership = new NativeOwnership(store)
    await ownership.upsert(entityInput({ id: 'service.a', revision: 'r1' }))
    await ownership.upsert(entityInput({ id: 'service.a', revision: 'r2' }))
    expect(store.revisions('service.a')).toEqual(['r2'])
  })

  it('cleans up what a crash between write and delete left behind', async () => {
    const store = new FakeStore()
    await new NativeOwnership(store).upsert(entityInput({ id: 'service.a', revision: 'r1' }))
    // The crash: r2 written, r1 never deleted.
    await store.write(entityInput({ id: 'service.a', revision: 'r2' }))
    expect(store.revisions('service.a').sort()).toEqual(['r1', 'r2'])

    await new NativeOwnership(store).upsert(entityInput({ id: 'service.a', revision: 'r2' }))
    expect(store.revisions('service.a')).toEqual(['r2'])
    expect(store.writes).toBe(2)
  })

  it('removes every record of an input, and removing it again is not an error', async () => {
    const store = new FakeStore()
    const ownership = new NativeOwnership(store)
    await ownership.upsert(entityInput({ id: 'service.a' }))
    await ownership.upsert(entityInput({ id: 'service.b' }))
    await ownership.remove('entity', 'service.a')
    await ownership.remove('entity', 'service.a')
    expect(store.revisions('service.a')).toEqual([])
    expect((await ownership.records()).map((record) => record.identity.id)).toEqual(['service.b'])
  })

  it('removes instead of writing a record that should not be indexed', async () => {
    const store = new FakeStore()
    const ownership = new NativeOwnership(store, (record) => record.kind !== 'entity' || record.index.fts)
    await ownership.upsert(entityInput({ id: 'service.a' }))
    await ownership.upsert(entityInput({ id: 'service.a', revision: 'r9', index: { graph: true, fts: false, vector: true } }))
    expect(store.revisions('service.a')).toEqual([])
  })

  it('clears the whole namespace from a fresh listing', async () => {
    const store = new FakeStore()
    const ownership = new NativeOwnership(store)
    await ownership.upsert(entityInput({ id: 'service.a' }))
    await store.write(entityInput({ id: 'service.z' }))
    await ownership.clear()
    expect(store.records.size).toBe(0)
    expect(await ownership.records()).toEqual([])
  })

  it('lists the engine once per instance until invalidated', async () => {
    const store = new FakeStore()
    const ownership = new NativeOwnership(store)
    await ownership.upsert(entityInput({ id: 'service.a' }))
    await ownership.upsert(entityInput({ id: 'service.b' }))
    expect(store.lists).toBe(1)
    ownership.invalidate()
    await ownership.records()
    expect(store.lists).toBe(2)
  })
})

describe('resolveNativeHits', () => {
  it('keeps current hits with their source span, and drops stale ones', async () => {
    const current = entityInput({ id: 'service.a', revision: 'r2', path: '.docket/a.md' })
    const services = fakeServices({ records: [current] })
    const resolved = await resolveNativeHits(
      [
        { nativeId: 'n1', identity: { kind: 'entity', id: 'service.a', revision: 'r2' }, text: 'a', score: 2 },
        { nativeId: 'n2', identity: { kind: 'entity', id: 'service.a', revision: 'r1' }, text: 'old a' },
        { nativeId: 'n3', identity: { kind: 'entity', id: 'service.gone', revision: 'r1' }, text: 'gone' },
        { nativeId: 'n4', identity: { kind: 'document', id: 'doc.x', revision: 'r1' }, text: 'unverified' }
      ],
      services.canonical
    )
    expect(resolved.stale).toBe(2)
    expect(resolved.hits).toEqual([
      { nativeId: 'n1', text: 'a', score: 2, ref: { kind: 'entity', id: 'service.a', revision: 'r2', span: { path: '.docket/a.md' } } },
      { nativeId: 'n4', text: 'unverified', ref: { kind: 'document', id: 'doc.x', revision: 'r1' } }
    ])
  })

  it('takes observation times from the canonical record, never from the engine', async () => {
    const services = fakeServices({
      records: [
        {
          kind: 'observation',
          id: 'obs.1',
          revision: 'r1',
          scope: 'contract-test',
          text: 'Deployed.',
          sources: [],
          entityRefs: [],
          observedAt: '2026-10-01T09:00:00Z',
          eventAt: '2026-09-30T17:00:00Z'
        }
      ]
    })
    const { hits } = await resolveNativeHits(
      [{ nativeId: 'n1', identity: { kind: 'observation', id: 'obs.1', revision: 'r1' }, text: 'Deployed.' }],
      services.canonical
    )
    expect(hits[0]).toMatchObject({ observedAt: '2026-10-01T09:00:00Z', eventAt: '2026-09-30T17:00:00Z' })
  })
})
