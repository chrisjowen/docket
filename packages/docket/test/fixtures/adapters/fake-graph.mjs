// A project-local query adapter that answers the way a graph engine does:
// counts as metrics and grouped counts as a typed table, enumerated
// exhaustively over the canonical entities it is handed - never document hits.
// `delayMs` makes it slow, to test deadlines and cancellation.

export default {
  apiVersion: 1,
  name: 'fake-graph',

  validateConfig(value) {
    const config = value ?? {}
    if (config.delayMs !== undefined && typeof config.delayMs !== 'number') throw new Error('delayMs must be a number')
    return { delayMs: 0, ...config }
  },

  async create(config, services) {
    return {
      describe: () => ({
        name: 'fake-graph',
        version: '1.0.0',
        inputs: [],
        resultKinds: ['metric', 'table'],
        rebuild: 'unsupported'
      }),
      status: async () => ({ state: 'connected', message: 'fake graph', engineVersion: '5.0.0' }),
      query: {
        async ask(request) {
          if (config.delayMs > 0) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, config.delayMs)
              request.signal?.addEventListener('abort', () => {
                clearTimeout(timer)
                reject(new Error('aborted'))
              })
            })
          }
          const entities = await services.canonical.list('entity')
          const byType = new Map()
          for (const entity of entities) byType.set(entity.type, [...(byType.get(entity.type) ?? []), entity])
          const types = [...byType.keys()].sort()
          const evidence = types.map((type, index) => ({
            id: `row-${index + 1}`,
            kind: 'derived-fact',
            text: `type: ${type}; count: ${byType.get(type).length}`,
            canonicalRefs: byType.get(type).map((entity) => ({ kind: 'entity', id: entity.id, revision: entity.revision })),
            derivation: { engine: 'fake-graph' }
          }))
          return {
            interpretation: {
              description: 'counted every entity by type',
              assumptions: ['Counts what the files record.'],
              nativeQuery: 'MATCH (n:Memory {scope: $scope}) RETURN n.type AS type, count(n) AS count'
            },
            blocks: [
              { kind: 'metric', id: 'total', label: 'entities', value: entities.length, evidenceIds: evidence.map((item) => item.id) },
              {
                kind: 'table',
                id: 'by-type',
                title: 'Entities by type',
                evidenceIds: [],
                columns: [
                  { key: 'type', label: 'type', type: 'string' },
                  { key: 'count', label: 'count', type: 'integer' }
                ],
                rows: types.map((type, index) => ({ cells: { type, count: byType.get(type).length }, evidenceIds: [`row-${index + 1}`] }))
              }
            ],
            evidence,
            coverage: { mode: 'exhaustive', truncated: false, scope: request.context.scope },
            diagnostics: []
          }
        }
      },
      close: async () => {}
    }
  }
}
