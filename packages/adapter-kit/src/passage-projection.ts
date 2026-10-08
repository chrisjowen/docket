import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { ApplyReceipt, CanonicalInput, InputKind, ProjectionBatch } from '@docket/contracts'

import { writeFileAtomic } from './atomic-write.js'
import { stableStringify } from './stable-json.js'

/**
 * Where a projection writes canonical inputs in a native engine, one input at
 * a time. Both operations are idempotent: replaying them never duplicates
 * native records, and every native record derived from an earlier revision is
 * gone once they return.
 */
export interface PassageSink {
  /** Makes `record` the only current native content for its canonical input. */
  upsert(record: CanonicalInput, signal?: AbortSignal): Promise<void>
  /** Removes every native record derived from the input. Removing what is not there is not an error. */
  remove(kind: InputKind, id: string, signal?: AbortSignal): Promise<void>
}

export interface ApplyChangesOptions {
  /** The one Docket scope this adapter instance projects. */
  scope: string
  /** The input kinds it declares; any other kind is refused. */
  inputs: readonly InputKind[]
  /** Whether a failed change is worth retrying. Defaults to yes: an engine that is down usually comes back. */
  retryable?: (error: unknown) => boolean
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Applies a batch change by change. Not atomic: each change is acknowledged
 * on its own, a failure is reported against its id and the rest still run.
 * A batch for another scope is refused whole - an instance never writes
 * outside its own scope. Changes left when `signal` aborts stay
 * unacknowledged, so the caller retries them.
 */
export const applyChanges = async (
  batch: ProjectionBatch,
  sink: PassageSink,
  options: ApplyChangesOptions,
  signal?: AbortSignal
): Promise<ApplyReceipt> => {
  const receipt: ApplyReceipt = { batchId: batch.batchId, applied: [], failed: [] }
  const retryable = options.retryable ?? (() => true)
  for (const change of batch.changes) {
    if (signal?.aborted) break
    const id = change.operation === 'upsert' ? change.record.id : change.id
    const kind = change.operation === 'upsert' ? change.record.kind : change.kind
    const refuse = (message: string): void => {
      receipt.failed.push({ id, retryable: false, message })
    }
    if (batch.scope !== options.scope) {
      refuse(`batch scope "${batch.scope}" is not this adapter's scope "${options.scope}"`)
      continue
    }
    if (!options.inputs.includes(kind)) {
      refuse(`this adapter does not project ${kind} inputs`)
      continue
    }
    if (change.operation === 'upsert' && change.record.scope !== batch.scope) {
      refuse(`record scope "${change.record.scope}" is not the batch's scope "${batch.scope}"`)
      continue
    }
    try {
      if (change.operation === 'upsert') await sink.upsert(change.record, signal)
      else await sink.remove(change.kind, change.id, signal)
      receipt.applied.push(id)
    } catch (error) {
      receipt.failed.push({ id, retryable: retryable(error), message: messageOf(error) })
    }
  }
  return receipt
}

/** Whether the receipt acknowledges every change in the batch as applied. */
export const appliedWhole = (batch: ProjectionBatch, receipt: ApplyReceipt): boolean =>
  receipt.failed.length === 0 && receipt.applied.length === batch.changes.length

/** A short, stable hash of whatever identifies what a projection writes to - engine, location, namespace. */
export const configFingerprint = (identity: unknown): string =>
  createHash('sha256').update(stableStringify(identity)).digest('hex').slice(0, 16)

interface CheckpointFileContents {
  version: 1
  scopes: Record<string, { checkpoint: string; fingerprint: string }>
}

export const CHECKPOINT_FILENAME = 'checkpoint.json'

/**
 * The last checkpoint an adapter instance acknowledged durably, per scope,
 * kept in its state root. Tied to a configuration fingerprint: once what the
 * instance writes to changes, the old checkpoint no longer vouches for
 * anything and reads back as none, so the caller must reconcile.
 */
export class CheckpointFile {
  readonly path: string

  constructor(
    stateRoot: string,
    private readonly fingerprint: string
  ) {
    this.path = join(stateRoot, CHECKPOINT_FILENAME)
  }

  async read(scope: string): Promise<string | undefined> {
    const entry = (await this.load()).scopes[scope]
    return entry !== undefined && entry.fingerprint === this.fingerprint ? entry.checkpoint : undefined
  }

  async write(scope: string, checkpoint: string): Promise<void> {
    const contents = await this.load()
    contents.scopes[scope] = { checkpoint, fingerprint: this.fingerprint }
    await writeFileAtomic(this.path, `${JSON.stringify(contents, null, 2)}\n`)
  }

  async clear(scope: string): Promise<void> {
    const contents = await this.load()
    if (!(scope in contents.scopes)) return
    delete contents.scopes[scope]
    if (Object.keys(contents.scopes).length === 0) await rm(this.path, { force: true })
    else await writeFileAtomic(this.path, `${JSON.stringify(contents, null, 2)}\n`)
  }

  private async load(): Promise<CheckpointFileContents> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, scopes: {} }
      throw error
    }
    const parsed = JSON.parse(text) as Partial<CheckpointFileContents>
    return { version: 1, scopes: { ...(parsed.scopes ?? {}) } }
  }
}
