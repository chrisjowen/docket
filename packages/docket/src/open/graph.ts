import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import matter from 'gray-matter'

import { DEFAULT_SCOPE, openDocket } from '../adapters/docket.js'
import type { ResolvedConfig } from '../config/config.js'
import { validate } from '../commands/validate.js'
import { planAdapter } from '../manifest/plan.js'
import { loadAdapterManifests } from '../manifest/state.js'
import type { Assessment, MemoryDocument, MemoryEntity } from '../model/index.js'
import { canonicalState } from '../sync/inputs.js'
import { iconFor } from '../ontology/icons.js'
import { MATTER_OPTIONS } from '../source/parser.js'
import type { UiAssessment, UiEdge, UiEntity, UiGraph, UiIndexStatus } from './types.js'

/** Dates and other YAML-specific values become what JSON would make of them. */
const plain = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>

/** The whole frontmatter, including fields the document model does not carry. */
const readFrontmatter = async (file: string): Promise<Record<string, unknown>> => {
  try {
    // Read the way the parser reads it: YAML 1.2, and no gray-matter cache.
    return plain(matter(await readFile(file, 'utf8'), MATTER_OPTIONS).data)
  } catch {
    return {}
  }
}

const assessmentOf = (assessed: Assessment): UiAssessment => ({
  confidence: assessed.confidence,
  basis: assessed.basis,
  evidenceCount: assessed.evidenceCount,
  sources: [...assessed.sources]
})

const toEntity = (entity: MemoryEntity, frontmatter: Record<string, unknown>): UiEntity => ({
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
    assessment: assessmentOf(link)
  })),
  mentions: entity.mentions,
  content: entity.content,
  ...(entity.provenance ? { provenance: plain(entity.provenance) } : {}),
  evidence: entity.evidence.map(plain),
  assessment: assessmentOf(entity),
  frontmatter
})

/**
 * How many entities the index has not caught up with - the plan `sync` would
 * carry out for each instance enabled for projection, read from its manifest
 * without connecting to it. An entity counts once however many of its
 * records, and however many instances, lag. Search answers from the index, so
 * a lagging one explains a search that misses what the graph shows.
 * Projections whose adapters cannot be loaded have synced nothing; searching
 * says why.
 */
export const indexStatus = async (
  resolved: ResolvedConfig,
  entities: readonly MemoryEntity[],
  documents: readonly MemoryDocument[],
  broken: ReadonlySet<string>
): Promise<UiIndexStatus> => {
  let docket
  try {
    docket = await openDocket(resolved)
  } catch {
    return { synced: false, behind: entities.length }
  }
  const slots = docket.adapters.filter((slot) => slot.roles.includes('projection'))
  const manifests = await loadAdapterManifests(resolved, slots, {
    legacyFingerprint: docket.projectionsFingerprint,
    configured: slots.map((slot) => slot.id)
  })
  if ([...manifests.values()].some((loaded) => loaded.reset)) return { synced: false, behind: entities.length }

  const state = canonicalState(entities, documents, DEFAULT_SCOPE)
  const behind = new Set<string>()
  for (const { manifest } of manifests.values()) {
    for (const { owner } of planAdapter(state, manifest, { inputs: new Set(manifest.inputs), broken }).changes) behind.add(owner)
  }
  return { synced: true, behind: behind.size }
}

/**
 * Every entity and relationship, read from the canonical files on each call -
 * never from a projection - so the UI shows exactly what the repository says,
 * synced or not. Entities are what projections receive: every file declaring
 * an id merged into one, with its confidence computed from the evidence.
 */
export const readGraph = async (cwd: string): Promise<UiGraph> => {
  const { resolved, ontology, entities, documents, broken, diagnostics } = await validate({ cwd })
  const frontmatters = await Promise.all(
    entities.map((entity) => readFrontmatter(join(resolved.projectRoot, entity.path)))
  )

  const known = new Set(entities.map((entity) => entity.id))
  const edges: UiEdge[] = entities.flatMap((entity) =>
    entity.links.map((link) => ({
      source: entity.id,
      rel: link.rel,
      target: link.target,
      ...(link.attributes ? { attributes: plain(link.attributes) } : {}),
      evidence: link.evidence.map(plain),
      assessment: assessmentOf(link),
      dangling: !known.has(link.target)
    }))
  )

  const definitions = (record: Record<string, { description?: string | undefined }> | undefined) =>
    Object.entries(record ?? {})
      .map(([name, definition]) => ({
        name,
        ...(definition.description ? { description: definition.description.trim() } : {})
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))

  return {
    project: { name: basename(resolved.projectRoot), root: resolved.projectRoot },
    entities: entities.map((entity, index) => toEntity(entity, frontmatters[index] ?? {})),
    edges,
    types: definitions(ontology?.resourceTypes).map((type) => ({
      ...type,
      icon: iconFor(type.name, ontology?.resourceTypes[type.name]?.icon)
    })),
    relationships: definitions(ontology?.relationships),
    diagnostics,
    index: await indexStatus(resolved, entities, documents, broken)
  }
}
