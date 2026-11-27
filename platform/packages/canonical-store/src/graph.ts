// SPDX-License-Identifier: AGPL-3.0-only
import { planAdapter } from '@chrisjowen/docket/manifest/plan'
import type { UiAssessment, UiEntity, UiGraph, UiIndexStatus } from '@chrisjowen/docket/open/types'
import { iconFor } from '@chrisjowen/docket/ontology/icons'
import { MATTER_OPTIONS } from '@chrisjowen/docket/source/parser'
import { canonicalState } from '@chrisjowen/docket/sync/inputs'
import { workspaceScope, type Tx } from '@docket/platform-tenancy'
import matter from 'gray-matter'

import { bandOf, type Diagnostic, type MemoryDocument, type MemoryEntity } from './docket.js'
import { readDocuments, type StoreContext } from './documents.js'
import { explainEntity, summarise, type Band, type TrustSummary } from './explain.js'
import { postgresManifests } from './postgres-manifests.js'
import { postgresSource } from './postgres-source.js'
import { currentRecord, dayOf, liveSupersessions, openProposals, type Supersession } from './supersession.js'
import { trustModel, validate, type TrustedSource } from './trust.js'
import { summaryPath } from './write.js'

export type { UiGraph, UiIndexStatus }

/**
 * The adapter instances every cloud workspace projects into (§6.3). The set is
 * fixed by the cloud, never by customer config (§6.4).
 */
export const CLOUD_PROJECTIONS = ['neo4j', 'mem0'] as const
export type CloudProjection = (typeof CLOUD_PROJECTIONS)[number]

/** Consecutive failed passes after which a workspace shows "index behind" with the adapter's message (§6.2). */
export const FAILURES_BEFORE_BEHIND = 5

/** One instance's standing, beyond docket's `{ synced, behind }`. */
export interface InstanceStatus {
  id: string
  /** Changes it has not acknowledged yet, counted per entity. */
  behind: number
  synced: boolean
  checkpoint: string | null
  syncedAt: string | null
  failures: number
  /** The adapter's last message; shown once `failures` reaches `FAILURES_BEFORE_BEHIND`. */
  error: string | null
}

/** `UiIndexStatus`, with each instance's standing for the cloud's status line. */
export interface CloudIndexStatus extends UiIndexStatus {
  instances: InstanceStatus[]
}

/** A record as the cloud's browser draws it: docket's `UiEntity`, with how far it is trusted and why. */
export interface CloudEntity extends UiEntity {
  trust: TrustSummary & {
    /** A pending proposal that it is replaced: it is still current until the proposal clears its bar. */
    pending?: PendingProposalView
    /** Pending proposals that it replaces records: not yet fact. */
    proposes?: (PendingProposalView & { replaces: string })[]
  }
}

/** A supersede proposal not yet fact, as the browser shows it. */
export interface PendingProposalView {
  proposal: string
  by: string
  score: number
  threshold: number
  stale: boolean
}

/** The graph a workspace's browser draws: docket's `UiGraph`, with the cloud's index status and trust. */
export interface CloudGraph extends UiGraph {
  entities: CloudEntity[]
  edges: (UiGraph['edges'][number] & { band: Band })[]
  index: CloudIndexStatus
  trust: {
    /** The ontology's bands: one definition for every view. */
    bands: { established: number; probable: number }
    /** The pending supersede proposals: the older record still current, the replacement waiting. */
    proposals: (PendingProposalView & { id: string })[]
  }
}

/** Dates and other YAML-specific values become what JSON would make of them, as `docket open` serves them. */
const plain = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>

/** The whole frontmatter, including fields the document model does not carry, read the way docket's parser reads it. */
export function frontmatterOf(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {}
  try {
    return plain(matter(raw, MATTER_OPTIONS as never).data)
  } catch {
    return {}
  }
}

/**
 * An entity's frontmatter, from its primary document. When that has no
 * `summary`, the `summary` fields of its consolidation summary document, so
 * the node shows it.
 */
function summarized(entity: MemoryEntity, raws: ReadonlyMap<string, string>): Record<string, unknown> {
  const own = frontmatterOf(raws.get(entity.path))
  const path = summaryPath(entity.id)
  if (own.summary !== undefined || path === entity.path || !entity.paths.includes(path)) return own
  const other = frontmatterOf(raws.get(path))
  return { ...own, ...Object.fromEntries(Object.entries(other).filter(([key]) => key === 'summary' || key.startsWith('summary_'))) }
}

/**
 * The frontmatter fields that show an entity's supersession, as `summary`
 * shows its consolidation summary: on a record gone out of date, what
 * replaces it now, until when it held, why and who said so; on a
 * replacement, the records it supersedes.
 */
export interface SupersessionFrontmatter {
  superseded_by?: string
  /** The record at the end of the chain, when the replacement was itself superseded since. */
  superseded_current?: string
  superseded_until?: string
  superseded_reason?: string
  superseded_source?: string
  superseded_recorded_by?: string
  supersedes?: string[]
}

function supersessionFields(id: string, supersessions: ReadonlyMap<string, Supersession>, replaces: ReadonlyMap<string, string[]>): SupersessionFrontmatter {
  const own = supersessions.get(id)
  const fields: SupersessionFrontmatter = {}
  if (own) {
    const current = currentRecord(supersessions, id)
    Object.assign(fields, {
      superseded_by: own.supersededBy,
      ...(current !== own.supersededBy ? { superseded_current: current } : {}),
      superseded_until: dayOf(own.validUntil),
      superseded_reason: own.reason,
      superseded_source: own.source,
      superseded_recorded_by: own.actorLabel,
    })
  }
  const older = replaces.get(id)
  if (older?.length) fields.supersedes = older
  return fields
}

const assessmentOf = (assessed: UiAssessment): UiAssessment => ({
  confidence: assessed.confidence,
  basis: assessed.basis,
  evidenceCount: assessed.evidenceCount,
  sources: [...assessed.sources],
})

const toEntity = (entity: MemoryEntity, frontmatter: Record<string, unknown>, trust: CloudEntity['trust']): CloudEntity => ({
  id: entity.id,
  type: entity.type,
  title: entity.title,
  path: entity.path,
  paths: [...entity.paths],
  tags: entity.tags,
  attributes: plain(entity.attributes),
  links: entity.links.map((link) => ({
    rel: link.rel,
    target: link.target,
    ...(link.attributes ? { attributes: plain(link.attributes) } : {}),
    evidence: link.evidence.map(plain),
    assessment: assessmentOf(link),
  })),
  mentions: entity.mentions,
  content: entity.content,
  ...(entity.provenance ? { provenance: plain(entity.provenance) } : {}),
  evidence: entity.evidence.map(plain),
  assessment: assessmentOf(entity),
  frontmatter,
  trust,
})

const errorPaths = (diagnostics: readonly Diagnostic[]): Set<string> =>
  new Set(diagnostics.flatMap((d) => (d.severity === 'error' && d.path !== undefined ? [d.path] : [])))

type StatusRow = {
  instance_id: string
  checkpoint: string | null
  failures: number
  last_error: string | null
  synced_at: Date | null
}

type StatusRead = { entities: readonly MemoryEntity[]; documents: readonly MemoryDocument[]; broken: ReadonlySet<string> }

/** Each named instance's standing and the entities it lags on, read from its manifest without connecting to its store. */
async function instanceStatuses(tx: Tx, workspaceId: string, read: StatusRead, ids: readonly string[]): Promise<{ instances: InstanceStatus[]; lagging: Set<string> }> {
  const manifests = postgresManifests(tx, workspaceId)
  const { rows } = await tx.query<StatusRow>(
    'SELECT instance_id, checkpoint, failures, last_error, synced_at FROM projection_status WHERE workspace_id = $1',
    [workspaceId],
  )
  const standing = new Map(rows.map((row) => [row.instance_id, row]))
  const state = canonicalState(read.entities, read.documents, workspaceScope(workspaceId))
  const lagging = new Set<string>()
  const instances: InstanceStatus[] = []
  for (const id of ids) {
    const manifest = await manifests.read(id)
    const row = standing.get(id)
    const base = {
      id,
      checkpoint: row?.checkpoint ?? null,
      syncedAt: row?.synced_at?.toISOString() ?? null,
      failures: row?.failures ?? 0,
      error: row?.last_error ?? null,
    }
    // No manifest, or one left by an unfinished reset: nothing vouches for what it holds.
    if (!manifest || manifest.fingerprint.startsWith('reset-pending:') || manifest.scope !== workspaceScope(workspaceId)) {
      for (const entity of read.entities) lagging.add(entity.id)
      instances.push({ ...base, synced: false, behind: read.entities.length })
      continue
    }
    const owners = new Set<string>()
    for (const { owner } of planAdapter(state, manifest, { inputs: new Set(manifest.inputs), broken: read.broken }).changes) {
      owners.add(owner)
      lagging.add(owner)
    }
    instances.push({ ...base, synced: true, behind: owners.size })
  }
  return { instances, lagging }
}

/**
 * How far each projection lags the canonical documents (§6.2): the plan sync
 * would carry out for each instance, read from its manifest in Postgres
 * without connecting to the store - `indexStatus` in `docket open`, with the
 * cloud's fixed instances. An entity counts once however many of its records,
 * and however many instances, lag. An optional projection (cognee) is not
 * counted: search answers without it, so it never makes the index "behind".
 */
export async function indexStatus(tx: Tx, workspaceId: string, read: StatusRead): Promise<CloudIndexStatus> {
  const { instances, lagging } = await instanceStatuses(tx, workspaceId, read, CLOUD_PROJECTIONS)
  return { synced: instances.every((instance) => instance.synced), behind: lagging.size, instances }
}

/** How far optional projections the workspace turned on (cognee) lag the documents, for Settings → Sync. */
export async function optionalStatus(tx: Tx, workspaceId: string, read: StatusRead, ids: readonly string[]): Promise<InstanceStatus[]> {
  return (await instanceStatuses(tx, workspaceId, read, ids)).instances
}

/**
 * Every entity and relationship of a workspace, read from its canonical
 * documents on each call - never from a projection - so the browser shows
 * exactly what the documents say, synced or not (`readGraph` in docket's
 * `docket open`, over Postgres). Its shape is docket-ui's `UiGraph`.
 */
export async function workspaceGraph(
  ctx: StoreContext,
  workspace: { id: string; slug: string; name: string },
  project: { root: string },
): Promise<CloudGraph> {
  // Decrypt once: the validation and the frontmatter both read these.
  const opened = await readDocuments(ctx, workspace.id)
  const source: TrustedSource = {
    ...postgresSource(ctx, workspace.id),
    async *documents() {
      for (const document of opened) {
        if (document.raw === undefined) yield { path: document.path, error: document.error ?? 'unreadable' }
        else yield { path: document.path, raw: document.raw, hash: document.hash }
      }
    },
  }
  const validation = await validate({ source })
  // The model validation scored with: the ontology's policies over what the org attests (read once, memoised).
  const model = trustModel(validation.ontology ?? { version: 1, resourceTypes: {}, relationships: {} }, await source.trust!())
  const raws = new Map(opened.flatMap((document) => (document.raw === undefined ? [] : [[document.path, document.raw] as const])))
  const { ontology, entities, documents, diagnostics } = validation
  const known = new Set(entities.map((entity) => entity.id))
  const supersessions = new Map((await liveSupersessions(ctx, workspace.id)).map((each) => [each.resourceId, each]))
  const pending = await openProposals(ctx, workspace.id)
  const view = (each: (typeof pending)[number]): PendingProposalView => ({ proposal: each.proposal, by: each.by, score: each.score, threshold: each.threshold, stale: each.stale })
  const trustOf = (entity: MemoryEntity): CloudEntity['trust'] => {
    const replacement = pending.find((each) => each.id === entity.id)
    const proposes = pending.filter((each) => each.by === entity.id)
    return {
      ...summarise(explainEntity(model, entity)),
      ...(replacement ? { pending: view(replacement) } : {}),
      ...(proposes.length ? { proposes: proposes.map((each) => ({ ...view(each), replaces: each.id })) } : {}),
    }
  }
  const replaces = new Map<string, string[]>()
  for (const each of supersessions.values()) replaces.set(each.supersededBy, [...(replaces.get(each.supersededBy) ?? []), each.resourceId])
  const edges = entities.flatMap((entity) =>
    entity.links.map((link) => ({
      source: entity.id,
      rel: link.rel,
      target: link.target,
      ...(link.attributes ? { attributes: plain(link.attributes) } : {}),
      evidence: link.evidence.map(plain),
      assessment: assessmentOf(link),
      band: bandOf(model, link.confidence),
      dangling: !known.has(link.target),
    })),
  )
  const definitions = (record: Record<string, { description?: string | undefined }> | undefined) =>
    Object.entries(record ?? {})
      .map(([name, definition]) => ({
        name,
        ...(definition.description ? { description: definition.description.trim() } : {}),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  return {
    project: { name: workspace.name, root: project.root },
    entities: entities.map((entity) => toEntity(entity, { ...summarized(entity, raws), ...supersessionFields(entity.id, supersessions, replaces) }, trustOf(entity))),
    edges,
    types: definitions(ontology?.resourceTypes).map((type) => ({
      ...type,
      icon: iconFor(type.name, ontology?.resourceTypes[type.name]?.icon),
    })),
    relationships: definitions(ontology?.relationships),
    diagnostics,
    index: await indexStatus(ctx.tx, workspace.id, { entities, documents, broken: errorPaths(diagnostics) }),
    trust: { bands: { ...model.bands }, proposals: pending.map((each) => ({ ...view(each), id: each.id })) },
  }
}
