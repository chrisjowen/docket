import { createHash } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { InputKind } from '@docket/contracts'
import { stableStringify, writeFileAtomic } from '@docket/adapter-kit'

export const ADAPTER_MANIFEST_VERSION = 2

/** Every adapter instance's manifest is `<state.dir>/manifests/<instance id>.json`. */
export const MANIFESTS_DIRNAME = 'manifests'

export const INPUT_KINDS: readonly InputKind[] = ['entity', 'observation', 'document']

/** What an instance durably holds of one canonical input. */
export interface RecordEntry {
  /** The revision it acknowledged. */
  revision: string
  /** The entity the input derives from, when it is not the entity itself. */
  owner?: string
}

/**
 * What sync knows one adapter instance holds (docs/adapter-spec.md §8). Each
 * instance has its own, so one failing never touches another's, and each is
 * tied to the instance's configuration fingerprint: written for another
 * endpoint, scope or config, it vouches for nothing.
 *
 * Written only after the instance flushed, and holding only what it
 * acknowledged, so it never gets ahead of what the instance holds. Nothing
 * derived from the run - no time, no batch id - is written, so the same
 * canonical files always give the same bytes.
 */
export interface AdapterManifest {
  version: typeof ADAPTER_MANIFEST_VERSION
  /** The instance id. */
  adapter: string
  /** Of the instance's module, configuration and scope. Never a secret: config names environment variables, and only its hash is kept. */
  fingerprint: string
  scope: string
  /** The adapter the records were projected with, as it described itself. */
  definition: { name: string; version: string }
  /** The input kinds it declared, so freshness can be judged without connecting to it. */
  inputs: InputKind[]
  /** Identifies exactly the records below: see `checkpointOf`. */
  checkpoint: string
  /** Every entity sync has read, with the files that declared it - what decides which records a broken file holds. */
  owners: Record<string, string[]>
  records: Record<InputKind, Record<string, RecordEntry>>
}

export const emptyRecords = (): AdapterManifest['records'] => ({ entity: {}, observation: {}, document: {} })

export const manifestsDir = (stateRoot: string): string => join(stateRoot, MANIFESTS_DIRNAME)

export const adapterManifestPath = (stateRoot: string, adapter: string): string =>
  join(manifestsDir(stateRoot), `${adapter}.json`)

const MODULUS = 1n << 256n

const entryDigest = (kind: InputKind, id: string, revision: string): bigint =>
  BigInt(`0x${createHash('sha256').update(`${kind}\u0000${id}\u0000${revision}`).digest('hex')}`)

/**
 * A checkpoint identifies a set of (kind, id, revision) records: the sum of
 * their hashes, modulo 2^256. Order-independent and updated one record at a
 * time, so every batch of a pass can carry the checkpoint of exactly what the
 * instance will hold once it is acknowledged, and the same records always
 * give the same checkpoint.
 */
export class Checkpoint {
  private sum = 0n

  static of(records: AdapterManifest['records']): Checkpoint {
    const checkpoint = new Checkpoint()
    for (const kind of INPUT_KINDS) {
      for (const [id, entry] of Object.entries(records[kind])) checkpoint.add(kind, id, entry.revision)
    }
    return checkpoint
  }

  add(kind: InputKind, id: string, revision: string): void {
    this.sum = (this.sum + entryDigest(kind, id, revision)) % MODULUS
  }

  delete(kind: InputKind, id: string, revision: string): void {
    this.sum = (this.sum - entryDigest(kind, id, revision) + MODULUS) % MODULUS
  }

  copy(): Checkpoint {
    const copy = new Checkpoint()
    copy.sum = this.sum
    return copy
  }

  toString(): string {
    return `records:${this.sum.toString(16).padStart(64, '0')}`
  }
}

export const checkpointOf = (records: AdapterManifest['records']): string => Checkpoint.of(records).toString()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/** Absent, unreadable or not this version: `undefined`, which vouches for nothing - the manifest is derived state. */
export const parseAdapterManifest = (raw: string): AdapterManifest | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.version !== ADAPTER_MANIFEST_VERSION) return undefined
  const { adapter, fingerprint, scope, definition, inputs, owners, records } = parsed
  if (typeof adapter !== 'string' || typeof fingerprint !== 'string' || typeof scope !== 'string') return undefined
  if (!isRecord(definition) || typeof definition.name !== 'string' || typeof definition.version !== 'string') return undefined
  if (!isStrings(inputs) || !inputs.every((kind) => INPUT_KINDS.includes(kind as InputKind))) return undefined
  if (!isRecord(owners) || !Object.values(owners).every(isStrings)) return undefined
  if (!isRecord(records)) return undefined

  const entries = emptyRecords()
  for (const kind of INPUT_KINDS) {
    const held = records[kind] ?? {}
    if (!isRecord(held)) return undefined
    for (const [id, entry] of Object.entries(held)) {
      if (!isRecord(entry) || typeof entry.revision !== 'string') return undefined
      if (entry.owner !== undefined && typeof entry.owner !== 'string') return undefined
      entries[kind][id] = { revision: entry.revision, ...(entry.owner !== undefined ? { owner: entry.owner } : {}) }
    }
  }
  return {
    version: ADAPTER_MANIFEST_VERSION,
    adapter,
    fingerprint,
    scope,
    definition: { name: definition.name, version: definition.version },
    inputs: inputs as InputKind[],
    // Recomputed rather than trusted, so it always identifies the records read.
    checkpoint: checkpointOf(entries),
    owners: owners as Record<string, string[]>,
    records: entries
  }
}

export const readAdapterManifest = async (stateRoot: string, adapter: string): Promise<AdapterManifest | undefined> => {
  try {
    return parseAdapterManifest(await readFile(adapterManifestPath(stateRoot, adapter), 'utf8'))
  } catch {
    return undefined
  }
}

/** Every instance manifest on disk, by the instance id its file is named for. */
export const listAdapterManifests = async (stateRoot: string): Promise<string[]> => {
  try {
    return (await readdir(manifestsDir(stateRoot)))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort()
  } catch {
    return []
  }
}

/** Keys sorted throughout, so identical records give identical bytes (spec §72). */
export const writeAdapterManifest = async (stateRoot: string, manifest: AdapterManifest): Promise<void> => {
  const sorted: unknown = JSON.parse(stableStringify({ ...manifest, checkpoint: checkpointOf(manifest.records) }))
  await writeFileAtomic(adapterManifestPath(stateRoot, manifest.adapter), `${JSON.stringify(sorted, null, 2)}\n`)
}

export const removeAdapterManifest = (stateRoot: string, adapter: string): Promise<void> =>
  rm(adapterManifestPath(stateRoot, adapter), { force: true })
