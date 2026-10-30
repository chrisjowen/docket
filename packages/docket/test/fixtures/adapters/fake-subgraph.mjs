// A project-local query adapter that answers the way a native graph traversal
// does: its matches as an entities block, and the subgraph it walked - nodes,
// edges with their evidence and confidence, and the paths it used - as a graph
// block. Every question gets the answer its config describes:
//
//   matches:  entity ids, most relevant first
//   graph:    { nodes, edges, paths } as a graph block holds them (optional)
//   evidence: [{ id, text, refs }] - the evidence the edges cite (optional)
//   note:     how it read the question (optional)

export default {
  apiVersion: 1,
  name: 'fake-subgraph',

  validateConfig(value) {
    const config = value ?? {}
    if (config.matches !== undefined && !Array.isArray(config.matches)) throw new Error('matches must be a list of entity ids')
    return { matches: [], evidence: [], ...config }
  },

  async create(config) {
    return {
      describe: () => ({
        name: 'fake-subgraph',
        version: '1.0.0',
        inputs: [],
        resultKinds: ['entities', 'graph'],
        rebuild: 'unsupported'
      }),
      status: async () => ({ state: 'connected', message: 'fake subgraph' }),
      query: {
        async ask(request) {
          return {
            interpretation: { description: config.note ?? 'fake native traversal', assumptions: [] },
            blocks: [
              {
                kind: 'entities',
                id: 'hits',
                evidenceIds: [],
                entities: config.matches.map((id) => ({ ref: { kind: 'entity', id } }))
              },
              ...(config.graph ? [{ kind: 'graph', id: 'subgraph', title: 'Traversal', evidenceIds: [], ...config.graph }] : [])
            ],
            evidence: config.evidence.map((item) => ({
              id: item.id,
              kind: 'derived-fact',
              text: item.text,
              canonicalRefs: (item.refs ?? []).map((id) => ({ kind: 'entity', id })),
              derivation: { engine: 'fake-subgraph' }
            })),
            coverage: { mode: 'top-k', truncated: false, scope: request.context.scope },
            diagnostics: []
          }
        }
      },
      close: async () => {}
    }
  }
}
