import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import matter from 'gray-matter'

import type { ResolvedConfig } from '../config/config.js'
import { validate } from '../commands/validate.js'
import { loadManifestState } from '../manifest/state.js'
import type { MemoryDocument } from '../model/index.js'
import type { UiEdge, UiEntity, UiGraph, UiIndexStatus } from './types.js'

/** Dates and other YAML-specific values become what JSON would make of them. */
const plain = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>

/** The whole frontmatter, including fields the document model does not carry. */
const readFrontmatter = async (file: string): Promise<Record<string, unknown>> => {
  try {
    // A fresh options object keeps gray-matter from serving a cached parse.
    return plain(matter(await readFile(file, 'utf8'), {}).data)
  } catch {
    return {}
  }
}

const toEntity = (document: MemoryDocument, frontmatter: Record<string, unknown>): UiEntity => ({
  id: document.id,
  type: document.type,
  title: document.title,
  path: document.path,
  tags: document.tags,
  attributes: plain(document.attributes),
  links: document.links.map((link) => ({
    rel: link.rel,
    target: link.target,
    ...(link.attributes ? { attributes: plain(link.attributes) } : {})
  })),
  mentions: document.mentions,
  content: document.content,
  ...(document.provenance ? { provenance: plain(document.provenance) } : {}),
  frontmatter
})

/**
 * How many documents the index has not caught up with. Search answers from the
 * index, so a lagging one explains a search that misses what the graph shows.
 */
export const indexStatus = async (
  resolved: ResolvedConfig,
  documents: readonly MemoryDocument[]
): Promise<UiIndexStatus> => {
  const state = await loadManifestState(resolved)
  if (state.stale) return { synced: false, behind: documents.length }

  const entries = state.manifest.documents
  const current = new Set(documents.map((document) => document.id))
  const changed = documents.filter((document) => {
    const entry = entries[document.id]
    return entry?.hash !== document.hash || entry.path !== document.path
  }).length
  const removed = Object.keys(entries).filter((id) => !current.has(id)).length
  return { synced: true, behind: changed + removed }
}

/**
 * Every entity and relationship, read from the canonical files on each call -
 * never from a projection - so the UI shows exactly what the repository says,
 * synced or not.
 */
export const readGraph = async (cwd: string): Promise<UiGraph> => {
  const { resolved, ontology, documents, diagnostics } = await validate({ cwd })
  const frontmatters = await Promise.all(
    documents.map((document) => readFrontmatter(join(resolved.projectRoot, document.path)))
  )

  const known = new Set(documents.map((document) => document.id))
  const edges: UiEdge[] = documents.flatMap((document) =>
    document.links.map((link) => ({
      source: document.id,
      rel: link.rel,
      target: link.target,
      ...(link.attributes ? { attributes: plain(link.attributes) } : {}),
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
    entities: documents.map((document, index) => toEntity(document, frontmatters[index] ?? {})),
    edges,
    types: definitions(ontology?.resourceTypes),
    relationships: definitions(ontology?.relationships),
    diagnostics,
    index: await indexStatus(resolved, documents)
  }
}
