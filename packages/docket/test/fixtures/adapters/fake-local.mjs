// A small project-local adapter: compiled JavaScript, no dependencies, held in
// memory. Projects entity inputs and answers questions with the entities whose
// title or body share a word with the question, quoting the body as evidence.

const words = (text) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])

export default {
  apiVersion: 1,
  name: 'fake-local',

  validateConfig(value) {
    if (!value || typeof value.label !== 'string') throw new Error('label is required')
    return { ...value }
  },

  async create(config, services) {
    const records = new Map()
    let checkpoint

    return {
      describe: () => ({
        name: 'fake-local',
        version: '1.0.0',
        inputs: ['entity'],
        resultKinds: ['entities', 'passages'],
        rebuild: 'deterministic'
      }),

      status: async () => ({
        state: 'ready',
        message: `${config.label}: ${records.size} records`,
        ...(checkpoint ? { checkpoint } : {})
      }),

      projection: {
        async apply(batch) {
          const applied = []
          for (const change of batch.changes) {
            if (change.operation === 'upsert') {
              records.set(change.record.id, change.record)
              applied.push(change.record.id)
            } else {
              records.delete(change.id)
              applied.push(change.id)
            }
          }
          checkpoint = batch.checkpoint
          return { batchId: batch.batchId, applied, failed: [] }
        },
        async reset() {
          records.clear()
          checkpoint = undefined
        }
      },

      query: {
        async ask(request) {
          const asked = words(request.question)
          const matches = [...records.values()]
            .filter((record) => [...words(`${record.title} ${record.content}`)].some((word) => asked.has(word)))
            .slice(0, request.budget.maxResults)
          const evidence = matches.map((record) => ({
            id: `passage:${record.id}`,
            kind: 'passage',
            text: record.content,
            canonicalRefs: [{ kind: 'entity', id: record.id, revision: record.revision }]
          }))
          return {
            interpretation: { description: `word overlap in ${config.label}`, assumptions: [] },
            blocks: [
              {
                kind: 'entities',
                id: 'matches',
                evidenceIds: [],
                entities: matches.map((record) => ({ ref: { kind: 'entity', id: record.id, revision: record.revision } }))
              },
              ...(evidence.length > 0
                ? [{ kind: 'passages', id: 'passages', evidenceIds: evidence.map((item) => item.id) }]
                : [])
            ],
            evidence,
            coverage: { mode: 'exhaustive', truncated: false, scope: request.context.scope },
            diagnostics: []
          }
        }
      },

      close: async () => {
        services.logger.debug('closed')
      }
    }
  }
}
