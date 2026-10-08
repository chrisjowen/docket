import { z } from 'zod'

import {
  adapterAnswerSchema,
  adapterDescriptionSchema,
  adapterStatusSchema,
  applyReceiptSchema,
  askRequestSchema,
  canonicalInputSchema,
  projectionBatchSchema
} from './schemas.js'
import {
  ADAPTER_API_VERSION,
  type AdapterAnswer,
  type AdapterDefinition,
  type AdapterDescription,
  type AdapterStatus,
  type ApplyReceipt,
  type AskRequest,
  type CanonicalInput,
  type MemoryAdapter,
  type ProjectionBatch
} from './types.js'

/** Something crossing the adapter boundary broke the contract. `issues` says each way it did. */
export class ContractError extends Error {
  constructor(
    /** What broke, without the issue list. */
    readonly summary: string,
    readonly issues: readonly string[]
  ) {
    super(issues.length === 0 ? summary : `${summary}:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ContractError'
  }
}

const issuesOf = (error: z.ZodError): string[] =>
  error.issues.map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`))

const parse = <T>(schema: z.ZodType<T>, value: unknown, what: string): T => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ContractError(`invalid ${what}`, issuesOf(parsed.error))
  return parsed.data
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Checks a module's default export is an adapter definition this package can
 * drive. The contract major is checked first, so a definition written for
 * another major fails before any of its code runs.
 */
export const validateAdapterDefinition = (value: unknown, source = 'adapter module'): AdapterDefinition => {
  if (!isObject(value)) {
    throw new ContractError(`${source} does not export an adapter definition`, [
      'the default export must be an object with apiVersion, name, validateConfig and create'
    ])
  }
  if (value.apiVersion !== ADAPTER_API_VERSION) {
    const found = value.apiVersion === undefined ? 'no apiVersion' : `apiVersion ${JSON.stringify(value.apiVersion)}`
    throw new ContractError(
      `${source} declares ${found}; this docket supports adapter apiVersion ${ADAPTER_API_VERSION}`,
      []
    )
  }
  const issues: string[] = []
  if (typeof value.name !== 'string' || value.name.length === 0) issues.push('name must be a non-empty string')
  if (typeof value.validateConfig !== 'function') issues.push('validateConfig must be a function')
  if (typeof value.create !== 'function') issues.push('create must be a function')
  if (issues.length > 0) throw new ContractError(`${source} is not a valid adapter definition`, issues)
  return value as unknown as AdapterDefinition
}

/** Checks the object `create` resolved to has the methods and ports it claims. */
export const validateMemoryAdapter = (value: unknown): MemoryAdapter => {
  if (!isObject(value)) throw new ContractError('create did not resolve to an adapter', ['expected an object'])
  const issues: string[] = []
  for (const method of ['describe', 'status', 'close']) {
    if (typeof value[method] !== 'function') issues.push(`${method} must be a function`)
  }
  const { projection, query } = value
  if (projection !== undefined) {
    if (!isObject(projection)) issues.push('projection must be an object')
    else {
      if (typeof projection.apply !== 'function') issues.push('projection.apply must be a function')
      if (typeof projection.reset !== 'function') issues.push('projection.reset must be a function')
      if (projection.flush !== undefined && typeof projection.flush !== 'function') {
        issues.push('projection.flush must be a function when present')
      }
    }
  }
  if (query !== undefined) {
    if (!isObject(query)) issues.push('query must be an object')
    else if (typeof query.ask !== 'function') issues.push('query.ask must be a function')
  }
  if (issues.length > 0) throw new ContractError('create resolved to an invalid adapter', issues)
  return value as unknown as MemoryAdapter
}

export const validateAdapterDescription = (value: unknown): AdapterDescription =>
  parse(adapterDescriptionSchema, value, 'adapter description')

export const validateAdapterStatus = (value: unknown): AdapterStatus =>
  parse(adapterStatusSchema, value, 'adapter status')

export const validateCanonicalInput = (value: unknown): CanonicalInput =>
  parse(canonicalInputSchema, value, 'canonical input')

export const validateProjectionBatch = (value: unknown): ProjectionBatch =>
  parse(projectionBatchSchema, value, 'projection batch')

export const validateAskRequest = (value: unknown): Omit<AskRequest, 'signal'> =>
  parse(askRequestSchema, value, 'ask request')

const changeId = (change: ProjectionBatch['changes'][number]): string =>
  change.operation === 'upsert' ? change.record.id : change.id

/**
 * Validates a receipt and, given the batch it answers, that it acknowledges
 * that batch and only changes in it. A change it names neither applied nor
 * failed is unacknowledged: the caller must not treat it as durable.
 */
export const validateApplyReceipt = (value: unknown, batch?: ProjectionBatch): ApplyReceipt => {
  const receipt = parse(applyReceiptSchema, value, 'apply receipt')
  if (batch === undefined) return receipt

  const issues: string[] = []
  if (receipt.batchId !== batch.batchId) {
    issues.push(`batchId is "${receipt.batchId}", but the batch applied was "${batch.batchId}"`)
  }
  const inBatch = new Set(batch.changes.map(changeId))
  const failed = new Set(receipt.failed.map((failure) => failure.id))
  for (const id of [...receipt.applied, ...failed]) {
    if (!inBatch.has(id)) issues.push(`"${id}" is not a change in the batch`)
  }
  for (const id of receipt.applied) {
    if (failed.has(id)) issues.push(`"${id}" is reported both applied and failed`)
  }
  if (issues.length > 0) throw new ContractError('invalid apply receipt', issues)
  return receipt
}

/** Ids of the batch's changes the receipt neither applied nor failed. */
export const unacknowledged = (batch: ProjectionBatch, receipt: ApplyReceipt): string[] => {
  const acknowledged = new Set([...receipt.applied, ...receipt.failed.map((failure) => failure.id)])
  return batch.changes.map(changeId).filter((id) => !acknowledged.has(id))
}

/**
 * Validates an answer: the block union, every evidence reference, plain-JSON
 * values throughout and, given the request, that it answers the scope asked.
 */
export const validateAdapterAnswer = (value: unknown, request?: Pick<AskRequest, 'context'>): AdapterAnswer => {
  const answer = parse(adapterAnswerSchema, value, 'adapter answer')
  if (request !== undefined && answer.coverage.scope !== request.context.scope) {
    throw new ContractError('invalid adapter answer', [
      `coverage.scope is "${answer.coverage.scope}", but the question was asked in scope "${request.context.scope}"`
    ])
  }
  return answer
}
