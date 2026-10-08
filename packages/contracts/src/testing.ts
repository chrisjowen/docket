import type {
  AdapterLogger,
  AdapterServices,
  AskRequest,
  CanonicalInput,
  EntityInput,
  InputKind,
  MemoryAdapter,
  ProjectionBatch
} from './types.js'
import {
  ContractError,
  unacknowledged,
  validateAdapterAnswer,
  validateAdapterDefinition,
  validateAdapterDescription,
  validateAdapterStatus,
  validateApplyReceipt,
  validateMemoryAdapter
} from './validate.js'

/*
 * Contract test helpers. Framework-agnostic: `checkAdapterContract` reports
 * every check it ran, and `assertAdapterContract` throws a `ContractError`
 * naming each one that failed, so any test runner can use them.
 */

export const SAMPLE_SCOPE = 'contract-test'

export interface LoggedMessage {
  level: keyof AdapterLogger
  message: string
  details?: Record<string, unknown>
}

export interface FakeServicesOptions {
  projectRoot?: string
  stateRoot?: string
  scope?: string
  /** Canonical records the read-only reader serves. */
  records?: CanonicalInput[]
  /** Environment the secret resolver reads; defaults to none. */
  env?: Record<string, string>
}

/** Services backed by memory: a recording logger, a fixed canonical store and a fixed environment. */
export const fakeServices = (
  options: FakeServicesOptions = {}
): AdapterServices & { logged: LoggedMessage[] } => {
  const logged: LoggedMessage[] = []
  const log =
    (level: keyof AdapterLogger) =>
    (message: string, details?: Record<string, unknown>): void => {
      logged.push({ level, message, ...(details ? { details } : {}) })
    }
  const records = options.records ?? []
  const env = options.env ?? {}
  return {
    projectRoot: options.projectRoot ?? '/project',
    stateRoot: options.stateRoot ?? '/project/.docket/.index/adapters/contract-test',
    scope: options.scope ?? SAMPLE_SCOPE,
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    canonical: {
      get: async (kind: InputKind, id: string) => records.find((record) => record.kind === kind && record.id === id),
      list: async (kind: InputKind) => records.filter((record) => record.kind === kind)
    },
    secrets: { getEnv: async (name: string) => env[name] },
    logged
  }
}

/** A small, valid entity input; override any field. */
export const sampleEntity = (overrides: Partial<EntityInput> = {}): EntityInput => ({
  kind: 'entity',
  id: 'service.orders',
  revision: 'sha256:0001',
  scope: SAMPLE_SCOPE,
  type: 'service',
  title: 'Orders',
  path: '.docket/resources/services/orders.md',
  paths: ['.docket/resources/services/orders.md'],
  tags: ['payments'],
  attributes: { tier: 1 },
  links: [
    {
      rel: 'depends_on',
      target: 'datasource.orders-db',
      evidence: [],
      confidence: 0.5,
      basis: 'unevidenced',
      evidenceCount: 0,
      sources: []
    }
  ],
  content: 'Takes and fulfils customer orders. Stores them in the orders database.',
  mentions: [],
  evidence: [{ source: 'code', path: 'services/orders/main.ts' }],
  index: { graph: true, fts: true, vector: true },
  confidence: 0.7,
  basis: 'evidence',
  evidenceCount: 1,
  sources: ['code'],
  ...overrides
})

/** A batch that upserts the sample entity, then removes another id. */
export const sampleBatch = (overrides: Partial<ProjectionBatch> = {}): ProjectionBatch => {
  const scope = overrides.scope ?? SAMPLE_SCOPE
  return {
    batchId: 'batch-1',
    scope,
    checkpoint: 'checkpoint-1',
    changes: [
      { operation: 'upsert', record: sampleEntity({ scope }) },
      { operation: 'remove', kind: 'entity', id: 'service.retired', revision: 'sha256:0000' }
    ],
    ...overrides
  }
}

/** A question about the sample entity, with a generous budget and deadline. */
export const sampleAskRequest = (overrides: Partial<AskRequest> = {}): AskRequest => {
  const now = new Date()
  return {
    requestId: 'request-1',
    question: 'Which service takes orders?',
    context: { scope: SAMPLE_SCOPE, now: now.toISOString(), timezone: 'UTC' },
    budget: {
      maxResults: 10,
      maxEvidenceBytes: 100_000,
      deadline: new Date(now.getTime() + 60_000).toISOString()
    },
    ...overrides
  }
}

export interface ContractCheckOptions {
  /** Config handed to `validateConfig`. */
  config: unknown
  /** When given, `validateConfig` must reject it. */
  invalidConfig?: unknown
  services?: AdapterServices
  /** Defaults to `sampleBatch`, filtered to the input kinds the adapter declares. */
  batch?: ProjectionBatch
  /** Defaults to `sampleAskRequest`, in the services' scope. */
  request?: AskRequest
}

export interface ContractCheck {
  name: string
  ok: boolean
  message?: string
}

export interface ContractReport {
  ok: boolean
  checks: ContractCheck[]
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/**
 * Drives a definition through its whole contract: envelope, config, create,
 * describe, status, projection (apply, replay, reset) and query, then close.
 * Each step is one check; a step that cannot run because an earlier one
 * failed is not reported.
 */
export const checkAdapterContract = async (
  definitionValue: unknown,
  options: ContractCheckOptions
): Promise<ContractReport> => {
  const checks: ContractCheck[] = []
  const report = (): ContractReport => ({ ok: checks.every((check) => check.ok), checks })
  const check = async <T>(name: string, run: () => T | Promise<T>): Promise<{ value: T } | undefined> => {
    try {
      const value = await run()
      checks.push({ name, ok: true })
      return { value }
    } catch (cause) {
      checks.push({ name, ok: false, message: messageOf(cause) })
      return undefined
    }
  }

  const definition = await check('definition envelope', () => validateAdapterDefinition(definitionValue))
  if (!definition) return report()

  const config = await check('validateConfig accepts the config', () => definition.value.validateConfig(options.config))
  if (!config) return report()

  if ('invalidConfig' in options) {
    await check('validateConfig rejects the invalid config', () => {
      let accepted = false
      try {
        definition.value.validateConfig(options.invalidConfig)
        accepted = true
      } catch {
        // Rejected, as it should be.
      }
      if (accepted) throw new Error('validateConfig accepted a config it should reject')
    })
  }

  const services = options.services ?? fakeServices()
  const created = await check('create resolves to an adapter', async () =>
    validateMemoryAdapter(await definition.value.create(config.value, services))
  )
  if (!created) return report()
  const adapter: MemoryAdapter = created.value

  try {
    const description = await check('describe', () => {
      const described = validateAdapterDescription(adapter.describe())
      if (adapter.projection && described.inputs.length === 0) {
        throw new Error('the adapter has a projection port but declares no input kinds')
      }
      if (adapter.query && described.resultKinds.length === 0) {
        throw new Error('the adapter has a query port but declares no result kinds')
      }
      return described
    })

    await check('status', async () => validateAdapterStatus(await adapter.status()))

    const projection = adapter.projection
    if (projection && description) {
      const declared = new Set(description.value.inputs)
      const given = options.batch ?? sampleBatch({ scope: services.scope })
      const batch: ProjectionBatch = {
        ...given,
        changes: given.changes.filter((change) =>
          declared.has(change.operation === 'upsert' ? change.record.kind : change.kind)
        )
      }

      const applyOnce = async (): Promise<void> => {
        const receipt = validateApplyReceipt(await projection.apply(batch), batch)
        const missing = unacknowledged(batch, receipt)
        if (missing.length > 0) throw new Error(`the receipt does not acknowledge ${missing.join(', ')}`)
      }
      await check('projection.apply acknowledges every change', applyOnce)
      await check('projection.apply replays the same batch', applyOnce)
      if (projection.flush) await check('projection.flush', () => projection.flush?.())
      await check('projection.reset', () => projection.reset(batch.scope))
    }

    const query = adapter.query
    if (query && description) {
      const sample = sampleAskRequest()
      const request = options.request ?? { ...sample, context: { ...sample.context, scope: services.scope } }
      await check('query.ask returns a valid answer', async () => {
        const answer = validateAdapterAnswer(await query.ask(request), request)
        const declared = new Set(description.value.resultKinds)
        const undeclared = answer.blocks.map((block) => block.kind).filter((kind) => !declared.has(kind))
        if (undeclared.length > 0) {
          throw new Error(`the answer has ${[...new Set(undeclared)].join(', ')} blocks the adapter does not declare`)
        }
      })
    }
  } finally {
    await check('close', () => adapter.close())
  }

  return report()
}

/** `checkAdapterContract`, throwing a `ContractError` that names every failed check. */
export const assertAdapterContract = async (
  definition: unknown,
  options: ContractCheckOptions
): Promise<ContractReport> => {
  const result = await checkAdapterContract(definition, options)
  if (!result.ok) {
    throw new ContractError(
      'the adapter breaks its contract',
      result.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.message ?? 'failed'}`)
    )
  }
  return result
}
