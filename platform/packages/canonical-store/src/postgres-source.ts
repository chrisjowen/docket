// SPDX-License-Identifier: AGPL-3.0-only
import { cloudResolvedConfig, hashContent } from './docket.js'
import { readDocuments, type StoreContext } from './documents.js'
import { orgTrust, type OrgTrust, type TrustedSource } from './trust.js'

export class NoPublishedOntology extends Error {
  override name = 'NoPublishedOntology'
  constructor(readonly workspaceId: string) {
    super(`workspace ${workspaceId} has no published ontology`)
  }
}

/** The text of the workspace's published head and its revision (`sha256:` of the text), or null. */
export async function publishedOntology(
  ctx: Pick<StoreContext, 'tx'>,
  workspaceId: string,
): Promise<{ text: string; revision: string; number: number } | null> {
  const { rows } = await ctx.tx.query<{ yaml: string; yaml_hash: string; number: number }>(
    `SELECT yaml, yaml_hash, number FROM ontology_versions
      WHERE workspace_id = $1 AND status = 'published' ORDER BY number DESC LIMIT 1`,
    [workspaceId],
  )
  const row = rows[0]
  return row ? { text: row.yaml, revision: row.yaml_hash, number: row.number } : null
}

/**
 * Docket's `CanonicalSource` over Postgres: the workspace's live documents,
 * decrypted with the org's key and hash-checked, its published ontology head,
 * and what the org attests about sources - its people directory, its
 * registry and its connected repositories - which person and other sources
 * are scored by. `ontology` overrides the head, for checking a draft against
 * the same documents. Reads inside the caller's transaction, so one pass sees
 * one snapshot, one query at a time on its connection whatever order docket asks.
 */
export function postgresSource(
  ctx: StoreContext,
  workspaceId: string,
  options: { ontology?: string } = {},
): TrustedSource {
  let pending: Promise<unknown> = Promise.resolve()
  const serial = <T>(read: () => Promise<T>): Promise<T> => {
    const result = pending.then(read)
    pending = result.catch(() => undefined)
    return result
  }
  let attested: Promise<OrgTrust> | undefined
  const trust = (): Promise<OrgTrust> => (attested ??= serial(() => orgTrust(ctx)))
  return {
    resolved: cloudResolvedConfig(workspaceId),
    async ontology() {
      if (options.ontology !== undefined) return { text: options.ontology, revision: hashContent(options.ontology) }
      const head = await serial(() => publishedOntology(ctx, workspaceId))
      if (!head) throw new NoPublishedOntology(workspaceId)
      return { text: head.text, revision: head.revision }
    },
    async people() {
      return (await trust()).people
    },
    trust,
    async *documents() {
      for (const document of await serial(() => readDocuments(ctx, workspaceId))) {
        if (document.raw === undefined) yield { path: document.path, error: document.error ?? 'unreadable' }
        else yield { path: document.path, raw: document.raw, hash: document.hash }
      }
    },
  }
}
