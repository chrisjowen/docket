import type { AdapterAnswer } from '@docket/contracts'

import type { AdaptersResponse, CoordinatedAnswer } from './wire.js'

/*
 * Fixture answers for every result block kind, written against the example
 * casebook in examples/acme-platform. Tests validate each one with the
 * contracts validators; `pnpm dev:fixtures` serves them as `POST /api/ask`
 * and `GET /api/adapters` until the coordinator exists.
 */

const SCOPE = 'default'

/** A lexical engine: entity hits and the passages they matched in. */
export const LOCAL_ANSWER: AdapterAnswer = {
  interpretation: { description: 'Keyword search for "orders" and "postgres" over exhibit text.', assumptions: [] },
  blocks: [
    {
      kind: 'entities',
      id: 'local:entities',
      title: 'Exhibits found',
      evidenceIds: ['local:ev-decision'],
      entities: [
        { ref: { kind: 'entity', id: 'decision.orders-on-postgres', revision: 'sha256:4be1' }, score: 7.2, detail: 'title, body' },
        { ref: { kind: 'entity', id: 'datasource.orders-db', revision: 'sha256:91c0' }, score: 4.1, detail: 'body' },
        { ref: { kind: 'entity', id: 'service.orders' }, score: 2.5 }
      ]
    },
    { kind: 'passages', id: 'local:passages', title: 'Where it says so', evidenceIds: ['local:ev-decision', 'local:ev-consequences'] }
  ],
  evidence: [
    {
      id: 'local:ev-decision',
      kind: 'passage',
      text: 'Order state lives in a single Postgres instance, `datasource.orders-db`, and `service.orders` is its only writer.',
      canonicalRefs: [
        {
          kind: 'entity',
          id: 'decision.orders-on-postgres',
          revision: 'sha256:4be1',
          span: { path: '.docket/decisions/orders-on-postgres.md', startLine: 29, endLine: 30 }
        }
      ],
      score: 7.2
    },
    {
      id: 'local:ev-consequences',
      kind: 'passage',
      text: 'Write throughput is capped by one primary. Measured peak is far below that ceiling, and the integrity bugs disappeared.',
      canonicalRefs: [
        {
          kind: 'entity',
          id: 'decision.orders-on-postgres',
          revision: 'sha256:4be1',
          span: { path: '.docket/decisions/orders-on-postgres.md', startLine: 34, endLine: 36 }
        }
      ],
      score: 3.9
    }
  ],
  coverage: { mode: 'top-k', truncated: false, scope: SCOPE, checkpoint: 'ckpt-0042' },
  diagnostics: []
}

/** A graph engine: a path, an exhaustive count, the rows behind it and their timeline. */
export const GRAPH_ANSWER: AdapterAnswer = {
  interpretation: {
    description: 'Deployments of service.orders to production in the last four weeks, and what the decision connects.',
    assumptions: ['"Deployments" means deployed_to observations of service.orders.', 'Weeks run Monday to Sunday in Asia/Singapore.'],
    timeRange: { from: '2026-09-10T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00' },
    nativeQuery:
      "MATCH (s:Entity {id: 'service.orders'})-[d:DEPLOYED_TO]->(e:Entity {id: 'environment.production'})\nWHERE d.eventAt >= datetime($from) AND d.eventAt < datetime($to)\nRETURN d.release AS release, d.eventAt AS at ORDER BY at"
  },
  blocks: [
    {
      kind: 'graph',
      id: 'enterprise-graph:path',
      title: 'How the decision reaches checkout',
      evidenceIds: [],
      nodes: [
        { id: 'n1', label: 'Keep order state in Postgres', type: 'decision', ref: { kind: 'entity', id: 'decision.orders-on-postgres' } },
        { id: 'n2', label: 'Orders', type: 'service', ref: { kind: 'entity', id: 'service.orders' } },
        { id: 'n3', label: 'Checkout', type: 'service', ref: { kind: 'entity', id: 'service.checkout' } },
        { id: 'n4', label: 'Orders DB', type: 'datasource', ref: { kind: 'entity', id: 'datasource.orders-db' } }
      ],
      edges: [
        { source: 'n1', target: 'n2', rel: 'applies_to', evidenceIds: ['enterprise-graph:ev-applies'] },
        { source: 'n1', target: 'n4', rel: 'applies_to' },
        { source: 'n3', target: 'n2', rel: 'depends_on', evidenceIds: ['enterprise-graph:ev-depends'] }
      ],
      paths: [['n1', 'n2', 'n3']]
    },
    {
      kind: 'metric',
      id: 'enterprise-graph:count',
      title: 'Deployments in four weeks',
      evidenceIds: ['enterprise-graph:ev-d1', 'enterprise-graph:ev-d2', 'enterprise-graph:ev-d3'],
      label: 'Production deployments of service.orders',
      value: 3,
      unit: 'deployments'
    },
    {
      kind: 'table',
      id: 'enterprise-graph:rows',
      title: 'The deployments counted',
      evidenceIds: [],
      columns: [
        { key: 'release', label: 'Release', type: 'string' },
        { key: 'service', label: 'Service', type: 'reference' },
        { key: 'at', label: 'Deployed', type: 'datetime' },
        { key: 'events', label: 'Events processed', type: 'decimal' },
        { key: 'rollback', label: 'Rolled back', type: 'boolean' }
      ],
      rows: [
        {
          cells: { release: '2026.09.12', service: { kind: 'entity', id: 'service.orders' }, at: '2026-09-12T10:04:00+08:00', events: '9007199254740993', rollback: false },
          evidenceIds: ['enterprise-graph:ev-d1']
        },
        {
          cells: { release: '2026.09.26', service: { kind: 'entity', id: 'service.orders' }, at: '2026-09-26T16:40:00+08:00', events: '120', rollback: true },
          evidenceIds: ['enterprise-graph:ev-d2']
        },
        {
          cells: { release: '2026.10.03', service: { kind: 'entity', id: 'service.orders' }, at: '2026-10-03T09:15:00+08:00', events: null, rollback: false },
          evidenceIds: ['enterprise-graph:ev-d3']
        }
      ]
    },
    {
      kind: 'timeline',
      id: 'enterprise-graph:timeline',
      title: 'Deployments and when they were recorded',
      evidenceIds: [],
      events: [
        { label: 'Release 2026.09.12 deployed', at: '2026-09-12T10:04:00+08:00', semantics: 'event', evidenceIds: ['enterprise-graph:ev-d1'] },
        { label: 'Release 2026.09.26 deployed', at: '2026-09-26T16:40:00+08:00', semantics: 'event', evidenceIds: ['enterprise-graph:ev-d2'] },
        { label: 'Rollback of 2026.09.26 recorded', at: '2026-09-27T08:00:00+08:00', semantics: 'observed', evidenceIds: ['enterprise-graph:ev-d2'] },
        { label: 'Release 2026.10.03 deployed', at: '2026-10-03T09:15:00+08:00', semantics: 'event', evidenceIds: ['enterprise-graph:ev-d3'] }
      ]
    }
  ],
  evidence: [
    {
      id: 'enterprise-graph:ev-applies',
      nativeId: 'rel:88213',
      kind: 'observation',
      text: 'decision.orders-on-postgres applies_to service.orders',
      canonicalRefs: [{ kind: 'entity', id: 'decision.orders-on-postgres', revision: 'sha256:4be1', span: { path: '.docket/decisions/orders-on-postgres.md', startLine: 10, endLine: 11 } }]
    },
    {
      id: 'enterprise-graph:ev-depends',
      nativeId: 'rel:88240',
      kind: 'observation',
      text: 'service.checkout depends_on service.orders',
      canonicalRefs: [{ kind: 'entity', id: 'service.checkout' }],
      observedAt: '2026-09-14'
    },
    ...[
      ['ev-d1', '2026-09-12T10:04:00+08:00', '2026-09-12T10:06:12+08:00'],
      ['ev-d2', '2026-09-26T16:40:00+08:00', '2026-09-27T08:00:00+08:00'],
      ['ev-d3', '2026-10-03T09:15:00+08:00', '2026-10-03T09:15:40+08:00']
    ].map(([id, eventAt, observedAt]) => ({
      id: `enterprise-graph:${id}`,
      nativeId: `obs:${id}`,
      kind: 'observation' as const,
      text: `Deploy pipeline reported service.orders deployed to environment.production.`,
      canonicalRefs: [{ kind: 'observation' as const, id: `observation.deploy-${id}`, revision: 'sha256:aa10' }],
      ...(eventAt ? { eventAt } : {}),
      ...(observedAt ? { observedAt } : {})
    }))
  ],
  coverage: { mode: 'exhaustive', truncated: false, scope: SCOPE, checkpoint: 'ckpt-0041' },
  diagnostics: [{ severity: 'info', code: 'checkpoint-behind', message: 'Projected to ckpt-0041; the files are at ckpt-0042.' }]
}

/** A recall engine: extracted facts, a sampled count that disagrees, and a block kind from a newer contract. */
export const RECALL_ANSWER = {
  interpretation: { description: 'Semantic recall over captured conversations and documents.', assumptions: ['Matched memories mentioning deployments.'] },
  blocks: [
    {
      kind: 'facts',
      id: 'company-memory:facts',
      title: 'What the memories say',
      evidenceIds: ['company-memory:fact-1', 'company-memory:fact-2']
    },
    {
      kind: 'metric',
      id: 'company-memory:count',
      evidenceIds: ['company-memory:fact-2'],
      label: 'Production deployments of service.orders',
      value: 2,
      unit: 'deployments'
    },
    {
      kind: 'heatmap',
      id: 'company-memory:heatmap',
      title: 'Activity by weekday',
      evidenceIds: ['company-memory:fact-2'],
      cells: [{ day: 'Fri', count: 2 }]
    }
  ],
  evidence: [
    {
      id: 'company-memory:fact-1',
      nativeId: 'mem_7f2a',
      kind: 'derived-fact',
      text: 'The team moved order state to Postgres because DynamoDB could not give multi-row transactions.',
      canonicalRefs: [{ kind: 'document', id: 'document.orders-retro', revision: 'sha256:c3d4', span: { path: '.docket/decisions/orders-on-postgres.md', startLine: 21, endLine: 25 } }],
      score: 0.83,
      derivation: { engine: 'mem0', model: 'claude-haiku-4-5' }
    },
    {
      id: 'company-memory:fact-2',
      nativeId: 'mem_91bc',
      kind: 'derived-fact',
      text: 'Orders was deployed twice last month, once on a Friday.',
      canonicalRefs: [],
      score: 0.61,
      derivation: { engine: 'mem0', model: 'claude-haiku-4-5' }
    }
  ],
  coverage: { mode: 'top-k', truncated: true, scope: SCOPE },
  diagnostics: []
} satisfies Omit<AdapterAnswer, 'blocks'> & { blocks: unknown[] }

export const FIXTURE_ANSWER: CoordinatedAnswer = {
  requestId: 'fixture',
  question: 'How many times was orders deployed in the last four weeks, and why is it on Postgres?',
  results: [
    { adapter: 'local', state: 'answered', answer: LOCAL_ANSWER, durationMs: 41 },
    { adapter: 'enterprise-graph', state: 'answered', answer: GRAPH_ANSWER, durationMs: 380 },
    { adapter: 'company-memory', state: 'answered', answer: RECALL_ANSWER as unknown as AdapterAnswer, durationMs: 1210 },
    {
      adapter: 'team-mem0',
      state: 'failed',
      error: { code: 'unavailable', message: 'Could not reach https://mem0.internal.example: connection refused.', retryable: true },
      durationMs: 3002
    }
  ],
  synthesis: {
    text:
      'Order state moved to Postgres because the lifecycle needs multi-row transactions [decision.orders-on-postgres]. ' +
      'The graph counts 3 production deployments of `service.orders` in the four weeks, exhaustively; recall memories mention 2, from a sample. The counts disagree.',
    citedEvidence: ['local:ev-decision', 'enterprise-graph:ev-d1', 'company-memory:fact-2'],
    citedEntities: ['decision.orders-on-postgres', 'service.orders'],
    model: 'claude-sonnet-5',
    cached: false,
    createdAt: '2026-10-08T13:00:00Z'
  },
  connections: [],
  diagnostics: []
}

export const FIXTURE_ADAPTERS: AdaptersResponse = {
  adapters: [
    {
      id: 'local',
      module: '@docket/adapter-jsonl',
      roles: ['projection', 'query'],
      description: { name: 'jsonl', version: '0.4.0', inputs: ['entity'], resultKinds: ['entities', 'passages'], rebuild: 'deterministic' },
      status: { state: 'ready', message: 'Index at .docket/.index/local', checkpoint: 'ckpt-0042', pending: 0 },
      freshness: { state: 'current', behind: 0, canonicalCheckpoint: 'ckpt-0042' }
    },
    {
      id: 'enterprise-graph',
      module: '@docket/adapter-neo4j',
      roles: ['projection', 'query'],
      description: { name: 'neo4j', version: '0.4.0', inputs: ['entity', 'observation'], resultKinds: ['entities', 'graph', 'metric', 'table', 'timeline'], rebuild: 'deterministic' },
      status: { state: 'connected', message: 'neo4j+s://graph.internal.example, database project-memory', checkpoint: 'ckpt-0041', pending: 3, engineVersion: '5.26.0' },
      freshness: { state: 'behind', behind: 3, canonicalCheckpoint: 'ckpt-0042' },
      runtime: 'graph-dev'
    },
    {
      id: 'company-memory',
      module: './tools/docket/company-memory.mjs',
      roles: ['query'],
      description: { name: 'company-memory', version: '1.0.0', inputs: ['document', 'observation'], resultKinds: ['passages', 'facts'], rebuild: 'reconstructible' },
      status: { state: 'degraded', message: 'Answering from a replica; ingest is paused.' },
      freshness: { state: 'unknown' }
    },
    {
      id: 'team-mem0',
      module: '@docket/adapter-mem0',
      roles: ['projection', 'query'],
      statusError: 'Could not reach https://mem0.internal.example: connection refused.',
      status: { state: 'unavailable', message: 'Connection refused.' },
      freshness: { state: 'unknown' }
    }
  ],
  query: { defaultAdapters: ['local', 'enterprise-graph', 'company-memory', 'team-mem0'], synthesis: true },
  diagnostics: []
}
