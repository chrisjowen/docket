import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CanonicalInput, InputKind, ProjectionBatch } from '@docket/contracts'
import { describe, expect, it } from 'vitest'

import { applyChanges, appliedWhole, CheckpointFile, configFingerprint, type PassageSink } from './passage-projection.js'
import { entityInput } from './testing.js'

const recordingSink = (failOn: string[] = []) => {
  const calls: string[] = []
  const sink: PassageSink = {
    upsert: async (record: CanonicalInput) => {
      if (failOn.includes(record.id)) throw new Error(`engine refused ${record.id}`)
      calls.push(`upsert ${record.kind} ${record.id}`)
    },
    remove: async (kind: InputKind, id: string) => {
      calls.push(`remove ${kind} ${id}`)
    }
  }
  return { sink, calls }
}

const batch = (overrides: Partial<ProjectionBatch> = {}): ProjectionBatch => ({
  batchId: 'b1',
  scope: 'default',
  checkpoint: 'c1',
  changes: [
    { operation: 'upsert', record: entityInput({ id: 'service.a' }) },
    { operation: 'remove', kind: 'entity', id: 'service.b', revision: 'r0' }
  ],
  ...overrides
})

describe('applyChanges', () => {
  it('applies each change and acknowledges it', async () => {
    const { sink, calls } = recordingSink()
    const receipt = await applyChanges(batch(), sink, { scope: 'default', inputs: ['entity'] })
    expect(receipt).toEqual({ batchId: 'b1', applied: ['service.a', 'service.b'], failed: [] })
    expect(calls).toEqual(['upsert entity service.a', 'remove entity service.b'])
    expect(appliedWhole(batch(), receipt)).toBe(true)
  })

  it('reports a failed change against its id, and still applies the rest', async () => {
    const { sink, calls } = recordingSink(['service.a'])
    const receipt = await applyChanges(batch(), sink, {
      scope: 'default',
      inputs: ['entity'],
      retryable: () => false
    })
    expect(receipt.applied).toEqual(['service.b'])
    expect(receipt.failed).toEqual([{ id: 'service.a', retryable: false, message: 'engine refused service.a' }])
    expect(calls).toEqual(['remove entity service.b'])
    expect(appliedWhole(batch(), receipt)).toBe(false)
  })

  it('refuses a batch for another scope without touching the engine', async () => {
    const { sink, calls } = recordingSink()
    const receipt = await applyChanges(batch({ scope: 'other' }), sink, { scope: 'default', inputs: ['entity'] })
    expect(receipt.applied).toEqual([])
    expect(receipt.failed.map((failure) => [failure.id, failure.retryable])).toEqual([
      ['service.a', false],
      ['service.b', false]
    ])
    expect(calls).toEqual([])
  })

  it('refuses kinds it does not declare and records from another scope', async () => {
    const { sink } = recordingSink()
    const receipt = await applyChanges(
      batch({
        changes: [
          { operation: 'upsert', record: entityInput({ id: 'service.a', scope: 'other' }) },
          { operation: 'remove', kind: 'document', id: 'doc.a', revision: 'r1' }
        ]
      }),
      sink,
      { scope: 'default', inputs: ['entity'] }
    )
    expect(receipt.failed.map((failure) => failure.message)).toEqual([
      'record scope "other" is not the batch\'s scope "default"',
      'this adapter does not project document inputs'
    ])
  })

  it('leaves the changes after an abort unacknowledged', async () => {
    const controller = new AbortController()
    const sink: PassageSink = {
      upsert: async () => controller.abort(),
      remove: async () => {}
    }
    const receipt = await applyChanges(batch(), sink, { scope: 'default', inputs: ['entity'] }, controller.signal)
    expect(receipt).toEqual({ batchId: 'b1', applied: ['service.a'], failed: [] })
  })
})

describe('CheckpointFile', () => {
  it('keeps a checkpoint per scope, and forgets it once the configuration changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docket-checkpoint-'))
    const first = new CheckpointFile(root, configFingerprint({ file: 'a.mv2' }))
    expect(await first.read('default')).toBeUndefined()
    await first.write('default', 'c1')
    await first.write('other', 'c9')
    expect(await first.read('default')).toBe('c1')
    expect(JSON.parse(await readFile(first.path, 'utf8')).scopes.other.checkpoint).toBe('c9')

    const moved = new CheckpointFile(root, configFingerprint({ file: 'b.mv2' }))
    expect(await moved.read('default')).toBeUndefined()

    await first.clear('default')
    expect(await first.read('default')).toBeUndefined()
    expect(await first.read('other')).toBe('c9')
  })

  it('fingerprints equal identities equally, whatever their key order', () => {
    expect(configFingerprint({ a: 1, b: 2 })).toBe(configFingerprint({ b: 2, a: 1 }))
    expect(configFingerprint({ a: 1 })).not.toBe(configFingerprint({ a: 2 }))
  })

  it('reads a file written by an older layout without failing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'docket-checkpoint-'))
    const checkpoints = new CheckpointFile(root, 'f')
    await writeFile(checkpoints.path, '{}')
    expect(await checkpoints.read('default')).toBeUndefined()
  })
})
