import { z } from 'zod'

import type {
  AdapterAnswer,
  AdapterDescription,
  AdapterStatus,
  ApplyReceipt,
  AskRequest,
  CanonicalInput,
  CanonicalReference,
  ProjectionBatch,
  ResultBlock,
  RetrievedEvidence,
  TableColumn
} from './types.js'

/*
 * Runtime schemas for every record that crosses the adapter boundary. Objects
 * are loose: an adapter may add optional extension fields and they survive
 * validation, but a required field must still be there with its own type.
 */

const nonEmpty = z.string().min(1)
const finite = z.number().refine(Number.isFinite, 'must be a finite number')

export const inputKindSchema = z.enum(['entity', 'observation', 'document'])
export const resultKindSchema = z.enum(['entities', 'passages', 'facts', 'graph', 'metric', 'table', 'timeline'])
export const adapterRoleSchema = z.enum(['projection', 'query'])

export const adapterDescriptionSchema: z.ZodType<AdapterDescription> = z.looseObject({
  name: nonEmpty,
  version: nonEmpty,
  inputs: z.array(inputKindSchema),
  resultKinds: z.array(resultKindSchema),
  rebuild: z.enum(['deterministic', 'reconstructible', 'unsupported'])
})

export const adapterStatusSchema: z.ZodType<AdapterStatus> = z.looseObject({
  state: z.enum(['connected', 'ready', 'degraded', 'unavailable']),
  message: z.string(),
  checkpoint: z.string().optional(),
  pending: z.number().int().nonnegative().optional(),
  engineVersion: z.string().optional()
})

const sourceLocationSchema = z.looseObject({
  path: nonEmpty,
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
})

const evidenceRecordSchema = z.looseObject({
  source: nonEmpty,
  repository: z.string().optional(),
  path: z.string().optional(),
  lines: z.string().optional(),
  symbol: z.string().optional(),
  key: z.string().optional(),
  method: z.string().optional(),
  endpoint: z.string().optional(),
  urls: z.array(z.string()).optional(),
  commit: z.string().optional(),
  observedAt: z.string().optional(),
  observedBy: z.string().optional(),
  session: z.string().optional(),
  note: z.string().optional()
})

const assessmentShape = {
  confidence: z.number().min(0).max(1),
  basis: z.enum(['evidence', 'stated', 'unevidenced']),
  evidenceCount: z.number().int().nonnegative(),
  sources: z.array(z.string())
}

const inputBaseShape = {
  id: nonEmpty,
  revision: nonEmpty,
  scope: nonEmpty
}

const entityInputSchema = z.looseObject({
  ...inputBaseShape,
  ...assessmentShape,
  kind: z.literal('entity'),
  type: nonEmpty,
  title: z.string(),
  path: nonEmpty,
  paths: z.array(nonEmpty).min(1),
  tags: z.array(z.string()),
  attributes: z.record(z.string(), z.unknown()),
  links: z.array(
    z.looseObject({
      ...assessmentShape,
      rel: nonEmpty,
      target: nonEmpty,
      attributes: z.record(z.string(), z.unknown()).optional(),
      evidence: z.array(evidenceRecordSchema)
    })
  ),
  content: z.string(),
  mentions: z.array(z.string()),
  evidence: z.array(evidenceRecordSchema),
  provenance: z
    .looseObject({
      authority: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      capturedBy: z.string().optional()
    })
    .optional(),
  index: z.looseObject({ graph: z.boolean(), fts: z.boolean(), vector: z.boolean() })
})

const observationInputSchema = z.looseObject({
  ...inputBaseShape,
  kind: z.literal('observation'),
  text: z.string(),
  sources: z.array(sourceLocationSchema),
  entityRefs: z.array(nonEmpty),
  observedAt: nonEmpty.optional(),
  eventAt: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  recordedIn: z.array(nonEmpty).optional(),
  evidence: evidenceRecordSchema.optional(),
  relationship: z.looseObject({ source: nonEmpty, rel: nonEmpty, target: nonEmpty }).optional()
})

const documentInputSchema = z.looseObject({
  ...inputBaseShape,
  kind: z.literal('document'),
  text: z.string(),
  source: sourceLocationSchema,
  entityRefs: z.array(nonEmpty)
})

export const canonicalInputSchema: z.ZodType<CanonicalInput> = z.discriminatedUnion('kind', [
  entityInputSchema,
  observationInputSchema,
  documentInputSchema
])

const recordChangeSchema = z.discriminatedUnion('operation', [
  z.looseObject({ operation: z.literal('upsert'), record: canonicalInputSchema }),
  z.looseObject({ operation: z.literal('remove'), kind: inputKindSchema, id: nonEmpty, revision: nonEmpty })
])

export const projectionBatchSchema: z.ZodType<ProjectionBatch> = z.looseObject({
  batchId: nonEmpty,
  scope: nonEmpty,
  checkpoint: nonEmpty,
  changes: z.array(recordChangeSchema)
})

export const applyReceiptSchema: z.ZodType<ApplyReceipt> = z.looseObject({
  batchId: nonEmpty,
  applied: z.array(nonEmpty),
  failed: z.array(z.looseObject({ id: nonEmpty, retryable: z.boolean(), message: z.string() }))
})

export const askRequestSchema: z.ZodType<Omit<AskRequest, 'signal'>> = z.looseObject({
  requestId: nonEmpty,
  question: nonEmpty,
  context: z.looseObject({
    scope: nonEmpty,
    now: z.iso.datetime({ offset: true }),
    timezone: nonEmpty,
    conversation: z
      .array(z.looseObject({ role: z.enum(['user', 'assistant']), content: z.string() }))
      .optional()
  }),
  budget: z.looseObject({
    maxResults: z.number().int().positive(),
    maxEvidenceBytes: z.number().int().positive(),
    deadline: z.iso.datetime({ offset: true })
  })
})

export const canonicalReferenceSchema: z.ZodType<CanonicalReference> = z
  .looseObject({
    kind: inputKindSchema,
    id: nonEmpty,
    revision: nonEmpty.optional(),
    span: sourceLocationSchema.optional()
  })
  .refine((reference) => reference.span === undefined || reference.revision !== undefined, {
    message: 'a source span needs the revision its lines refer to',
    path: ['revision']
  })

export const retrievedEvidenceSchema: z.ZodType<RetrievedEvidence> = z.looseObject({
  id: nonEmpty,
  nativeId: z.string().optional(),
  kind: z.enum(['passage', 'observation', 'derived-fact']),
  text: z.string(),
  canonicalRefs: z.array(canonicalReferenceSchema),
  observedAt: z.string().optional(),
  eventAt: z.string().optional(),
  score: finite.optional(),
  derivation: z.looseObject({ engine: nonEmpty, model: z.string().optional() }).optional()
})

const evidenceIds = z.array(nonEmpty)

const blockBaseShape = {
  id: nonEmpty,
  title: z.string().optional(),
  evidenceIds
}

const columnTypeSchema = z.enum(['string', 'number', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'reference'])

export const resultBlockSchema: z.ZodType<ResultBlock> = z.discriminatedUnion('kind', [
  z.looseObject({
    ...blockBaseShape,
    kind: z.literal('entities'),
    entities: z.array(
      z.looseObject({ ref: canonicalReferenceSchema, score: finite.optional(), detail: z.string().optional() })
    )
  }),
  z.looseObject({ ...blockBaseShape, kind: z.literal('passages'), evidenceIds: evidenceIds.min(1) }),
  z.looseObject({ ...blockBaseShape, kind: z.literal('facts'), evidenceIds: evidenceIds.min(1) }),
  z.looseObject({
    ...blockBaseShape,
    kind: z.literal('graph'),
    nodes: z.array(
      z.looseObject({ id: nonEmpty, label: z.string(), type: z.string().optional(), ref: canonicalReferenceSchema.optional() })
    ),
    edges: z.array(
      z.looseObject({ source: nonEmpty, target: nonEmpty, rel: nonEmpty, evidenceIds: evidenceIds.optional() })
    ),
    paths: z.array(z.array(nonEmpty).min(1)).optional()
  }),
  z.looseObject({ ...blockBaseShape, kind: z.literal('metric'), label: nonEmpty, value: finite, unit: z.string().optional() }),
  z.looseObject({
    ...blockBaseShape,
    kind: z.literal('table'),
    columns: z.array(z.looseObject({ key: nonEmpty, label: z.string(), type: columnTypeSchema })),
    rows: z.array(
      z.looseObject({
        cells: z.record(z.string(), z.unknown()),
        evidenceIds: evidenceIds.optional()
      })
    )
  }),
  z.looseObject({
    ...blockBaseShape,
    kind: z.literal('timeline'),
    events: z.array(
      z.looseObject({
        label: nonEmpty,
        at: nonEmpty,
        semantics: z.enum(['event', 'observed', 'valid-from', 'valid-to']),
        evidenceIds: evidenceIds.optional()
      })
    )
  })
]) as z.ZodType<ResultBlock>

/** Why `value` cannot be a cell of a column of `type`, or undefined when it can. */
const cellProblem = (type: TableColumn['type'], value: unknown): string | undefined => {
  if (value === null) return undefined
  switch (type) {
    case 'string':
    case 'date':
    case 'datetime':
      return typeof value === 'string' ? undefined : `a ${type} cell must be a string`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'a number cell must be a finite number'
    case 'integer':
      return Number.isSafeInteger(value)
        ? undefined
        : 'an integer cell must be a safe integer - use a decimal column for larger values'
    case 'decimal':
      return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
        ? undefined
        : 'a decimal cell must be a string of digits, e.g. "9007199254740993"'
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'a boolean cell must be true or false'
    case 'reference':
      return canonicalReferenceSchema.safeParse(value).success ? undefined : 'a reference cell must be a canonical reference'
  }
}

/**
 * Where `value` stops being plain JSON - a Date, BigInt, function, Map, class
 * instance or non-finite number - or undefined when it is plain throughout.
 */
export const plainJsonProblem = (value: unknown, path: (string | number)[] = []): string | undefined => {
  const at = (): string => (path.length === 0 ? 'the value' : path.join('.'))
  if (value === null || value === undefined) return undefined
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return undefined
    case 'number':
      return Number.isFinite(value) ? undefined : `${at()} is not a finite number`
    case 'bigint':
      return `${at()} is a BigInt - use a decimal string`
    case 'function':
    case 'symbol':
      return `${at()} is a ${typeof value}`
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const problem = plainJsonProblem(item, [...path, index])
      if (problem) return problem
    }
    return undefined
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    const name = (value as { constructor?: { name?: string } }).constructor?.name ?? 'object'
    return `${at()} is a ${name}, not a plain JSON object`
  }
  for (const [key, item] of Object.entries(value)) {
    const problem = plainJsonProblem(item, [...path, key])
    if (problem) return problem
  }
  return undefined
}

/** Every evidence id an answer's blocks, rows, edges and events point at, with where. */
const evidenceReferences = (blocks: readonly ResultBlock[]): { id: string; path: (string | number)[] }[] => {
  const references: { id: string; path: (string | number)[] }[] = []
  const add = (ids: readonly string[] | undefined, path: (string | number)[]): void => {
    for (const [index, id] of (ids ?? []).entries()) references.push({ id, path: [...path, 'evidenceIds', index] })
  }
  for (const [index, block] of blocks.entries()) {
    const at = ['blocks', index]
    add(block.evidenceIds, at)
    if (block.kind === 'graph') for (const [i, edge] of block.edges.entries()) add(edge.evidenceIds, [...at, 'edges', i])
    if (block.kind === 'table') for (const [i, row] of block.rows.entries()) add(row.evidenceIds, [...at, 'rows', i])
    if (block.kind === 'timeline') for (const [i, event] of block.events.entries()) add(event.evidenceIds, [...at, 'events', i])
  }
  return references
}

const duplicates = (values: readonly string[]): string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]

export const adapterAnswerSchema: z.ZodType<AdapterAnswer> = z
  .looseObject({
    interpretation: z.looseObject({
      description: z.string(),
      assumptions: z.array(z.string()),
      timeRange: z.looseObject({ from: nonEmpty, to: nonEmpty }).optional(),
      nativeQuery: z.string().optional()
    }),
    blocks: z.array(resultBlockSchema),
    evidence: z.array(retrievedEvidenceSchema),
    coverage: z.looseObject({
      mode: z.enum(['exhaustive', 'top-k', 'unknown']),
      truncated: z.boolean(),
      scope: nonEmpty,
      checkpoint: z.string().optional()
    }),
    diagnostics: z.array(
      z.looseObject({ severity: z.enum(['info', 'warning', 'error']), code: nonEmpty, message: z.string() })
    )
  })
  .superRefine((answer, context) => {
    const problem = plainJsonProblem(answer)
    if (problem) context.addIssue({ code: 'custom', message: `answers must be plain JSON: ${problem}` })

    const evidenceIds = answer.evidence.map((evidence) => evidence.id)
    for (const id of duplicates(evidenceIds)) {
      context.addIssue({ code: 'custom', path: ['evidence'], message: `evidence id "${id}" is used more than once` })
    }
    for (const id of duplicates(answer.blocks.map((block) => block.id))) {
      context.addIssue({ code: 'custom', path: ['blocks'], message: `block id "${id}" is used more than once` })
    }

    const known = new Set(evidenceIds)
    for (const reference of evidenceReferences(answer.blocks)) {
      if (!known.has(reference.id)) {
        context.addIssue({ code: 'custom', path: reference.path, message: `no evidence has id "${reference.id}"` })
      }
    }

    for (const [index, block] of answer.blocks.entries()) {
      if (block.kind === 'graph') {
        const nodes = new Set(block.nodes.map((node) => node.id))
        for (const id of duplicates(block.nodes.map((node) => node.id))) {
          context.addIssue({ code: 'custom', path: ['blocks', index, 'nodes'], message: `node id "${id}" is used more than once` })
        }
        for (const [i, edge] of block.edges.entries()) {
          for (const end of [edge.source, edge.target]) {
            if (!nodes.has(end)) {
              context.addIssue({ code: 'custom', path: ['blocks', index, 'edges', i], message: `edge end "${end}" is not a node` })
            }
          }
        }
        for (const [i, path] of (block.paths ?? []).entries()) {
          for (const id of path) {
            if (!nodes.has(id)) {
              context.addIssue({ code: 'custom', path: ['blocks', index, 'paths', i], message: `path node "${id}" is not a node` })
            }
          }
        }
      }
      if (block.kind === 'table') {
        const columns = new Map(block.columns.map((column) => [column.key, column]))
        for (const key of duplicates(block.columns.map((column) => column.key))) {
          context.addIssue({ code: 'custom', path: ['blocks', index, 'columns'], message: `column "${key}" is declared more than once` })
        }
        for (const [i, row] of block.rows.entries()) {
          for (const [key, value] of Object.entries(row.cells)) {
            const column = columns.get(key)
            const problem = column ? cellProblem(column.type, value) : `column "${key}" is not declared`
            if (problem) {
              context.addIssue({ code: 'custom', path: ['blocks', index, 'rows', i, 'cells', key], message: problem })
            }
          }
        }
      }
    }
  })
