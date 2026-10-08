// A project-local adapter that keeps what it is handed in its state root:
// `store.json`, one record per (kind, id) however often a change is replayed,
// and `batches.json`, every batch it was given. Declares the input kinds its
// config lists. Faults are runtime state, not config, so they come and go
// without changing the instance's fingerprint: ids listed in `refuse.json` in
// its state root fail, and while `down` exists there every apply throws, as an
// unreachable engine would.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const read = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

export default {
  apiVersion: 1,
  name: 'recording',

  validateConfig(value) {
    const config = value ?? {}
    if (!Array.isArray(config.inputs)) throw new Error('inputs is required')
    return { ...config }
  },

  async create(config, services) {
    const storePath = join(services.stateRoot, 'store.json')
    const batchesPath = join(services.stateRoot, 'batches.json')
    const save = async (store, batches) => {
      await mkdir(services.stateRoot, { recursive: true })
      await writeFile(storePath, JSON.stringify(store, null, 2))
      await writeFile(batchesPath, JSON.stringify(batches, null, 2))
    }

    return {
      describe: () => ({
        name: 'recording',
        version: '1.0.0',
        inputs: config.inputs,
        resultKinds: [],
        rebuild: 'deterministic'
      }),
      status: async () => ({ state: 'ready', message: 'recording' }),
      projection: {
        async apply(batch) {
          if ((await read(join(services.stateRoot, 'down'), undefined)) !== undefined) throw new Error('connection refused')
          const refuse = await read(join(services.stateRoot, 'refuse.json'), [])
          const store = await read(storePath, {})
          const batches = await read(batchesPath, [])
          batches.push(batch)
          const applied = []
          const failed = []
          for (const change of batch.changes) {
            const id = change.operation === 'upsert' ? change.record.id : change.id
            const kind = change.operation === 'upsert' ? change.record.kind : change.kind
            if (refuse.includes(id)) {
              failed.push({ id, retryable: false, message: 'refused' })
              continue
            }
            if (change.operation === 'upsert') store[`${kind}:${id}`] = change.record
            else delete store[`${kind}:${id}`]
            applied.push(id)
          }
          await save(store, batches)
          return { batchId: batch.batchId, applied, failed }
        },
        async reset(scope) {
          const batches = await read(batchesPath, [])
          batches.push({ reset: scope })
          await save({}, batches)
        }
      },
      close: async () => {}
    }
  }
}
