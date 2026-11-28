// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How a workspace's data reaches its stores and how its questions are
 * answered, as Settings → Sync and Settings → Queries show it: read-only, from
 * the worker's sync history and query traces.
 */

/** A workspace's Settings pages, as tabs under the Settings heading. */
export const SETTINGS_TABS = [
  { key: 'general', label: 'General', route: '/a/[acct]/d/[docket]/settings' },
  { key: 'sync', label: 'Sync', route: '/a/[acct]/d/[docket]/settings/sync' },
  { key: 'queries', label: 'Queries', route: '/a/[acct]/d/[docket]/settings/queries' },
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]['key']

/** The stores, in the order data flows through them: documents first, then what is projected from them. */
export const STORES = {
  documents: { name: 'Documents', engine: 'Postgres', role: 'The source of truth: every write lands here first, encrypted with the org’s key.' },
  neo4j: { name: 'Graph', engine: 'Neo4j', role: 'Exhibits and their links, projected from the documents, for graph queries and full-text search.' },
  mem0: { name: 'Search index', engine: 'mem0 on Qdrant', role: 'One memory per exhibit, embedded on the box, for semantic search.' },
  cognee: {
    name: 'cognee',
    engine: 'knowledge graph, optional',
    role: 'Optional, turned on in Settings: each exhibit cognified into cognee’s knowledge graph with the org’s AI, and searched above a similarity floor.',
  },
} as const

export type StoreKey = keyof typeof STORES

export const storeName = (id: string): string => (id in STORES ? STORES[id as StoreKey].name : id)

/** What woke a pass, in words. */
export const TRIGGER_LABELS: Record<string, string> = {
  documents: 'documents changed',
  ontology: 'ontology published',
  rebuild: 'rebuild requested',
  recheck: 're-check requested',
  trust: 'people or sources re-attested',
}

export function triggersText(triggers: readonly string[]): string {
  if (triggers.length === 0) return 'what woke it could not be read'
  return triggers.map((trigger) => TRIGGER_LABELS[trigger] ?? trigger).join(', ')
}

/** A span of milliseconds, as a person reads it. */
export function duration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`
  const seconds = ms / 1_000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 48) return `${Math.round(hours)} h`
  return `${Math.round(hours / 24)} days`
}

/** How long ago `iso` was, from `now`: "just now", "3 min ago". */
export function ago(iso: string | null, now: number): string {
  if (!iso) return 'never'
  const ms = now - new Date(iso).getTime()
  if (ms < 5_000) return 'just now'
  return `${duration(ms)} ago`
}

/** What a question cost, in dollars: to the cent when it is a cent or more, else to the hundredth of a cent. */
export function cost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd >= 0.01) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(4)}`
}

/** The honest label for who wrote the query a store ran. */
export function queryLabel(query: { by: 'template' | 'model'; model?: string; fallback?: string }): string {
  if (query.by === 'model') return query.model ? `Model-written, by ${query.model}` : 'Model-written'
  return query.fallback ? 'Template, after the model’s query did not answer' : 'Template: a fixed query, no model wrote it'
}

export interface TimelineEntry<S, D> {
  at: string
  kind: 'sync' | 'documents'
  sync?: S
  documents?: D
}

/** Passes and document changes as one history, newest first. */
export function timeline<S extends { at: string }, D extends { at: string }>(
  syncs: readonly S[],
  documents: readonly D[],
  limit = 60,
): TimelineEntry<S, D>[] {
  return [
    ...syncs.map((sync) => ({ at: sync.at, kind: 'sync' as const, sync })),
    ...documents.map((entry) => ({ at: entry.at, kind: 'documents' as const, documents: entry })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
}
