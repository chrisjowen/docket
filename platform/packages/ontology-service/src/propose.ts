// SPDX-License-Identifier: AGPL-3.0-only
import { lockOntologyHead, recordIngest, type StoreContext, type Writer } from '@docket/platform-canonical-store'
import { isMap, parseDocument, stringify } from 'yaml'

import { checkDraft, type Disposition, type DraftCheck } from './check.js'
import { OntologyInvalid, OntologyWriteDisabled } from './errors.js'
import type { Migration } from './migrations.js'
import { createDraft, headOf, publish, type OntologyVersion, type Published } from './versions.js'
import { sizeProblem } from './yaml-io.js'

/** What `docket_propose_ontology_change` takes: a whole ontology, or a merge patch onto the head. */
export type Proposal = { yaml: string; message?: string } | { patch: string; message?: string }

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A JSON merge patch (RFC 7396) applied to YAML values: a mapping merges key
 * by key, `null` removes a key, anything else replaces what was there.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlain(patch)) return patch
  const out: Record<string, unknown> = isPlain(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else out[key] = mergePatch(out[key], value)
  }
  return out
}

/**
 * The text a proposal makes: a whole ontology as given, or the head with the
 * patch merged into it. A patch keeps the head's comments where it does not
 * touch them. Throws `OntologyInvalid` for a patch that is not a YAML mapping.
 */
export function proposedText(head: string | null, proposal: Proposal): string {
  if ('yaml' in proposal) return proposal.yaml
  const tooLarge = sizeProblem(proposal.patch)
  if (tooLarge) throw new OntologyInvalid([tooLarge])
  const patchDoc = parseDocument(proposal.patch)
  if (patchDoc.errors.length || !isMap(patchDoc.contents)) {
    throw new OntologyInvalid([
      { severity: 'error', code: 'invalid-patch', message: `The patch is not a YAML mapping${patchDoc.errors[0] ? `: ${patchDoc.errors[0].message}` : ''}.` },
    ])
  }
  const patch = patchDoc.toJS() as Record<string, unknown>
  if (head === null) return stringify(mergePatch({}, patch), { lineWidth: 0 })
  const doc = parseDocument(head)
  const apply = (path: string[], value: unknown) => {
    if (value === null) {
      doc.deleteIn(path)
      return
    }
    const current = doc.getIn(path)
    if (isPlain(value) && isMap(doc.getIn(path, true)) && current !== undefined) {
      for (const [key, inner] of Object.entries(value)) apply([...path, key], inner)
      return
    }
    doc.setIn(path, doc.createNode(isPlain(value) ? mergePatch(isPlain(current) ? current : undefined, value) : value))
  }
  for (const [key, value] of Object.entries(patch)) apply([key], value)
  return doc.toString({ lineWidth: 0 })
}

/**
 * `docket_propose_ontology_change` (§9): makes a draft from the proposal and
 * checks it against every document of the workspace. It never publishes: an
 * admin does that in the web app. The draft is recorded in the activity log.
 */
export async function proposeOntologyChange(
  ctx: StoreContext,
  writer: Writer,
  proposal: Proposal,
): Promise<{ draft: OntologyVersion; check: DraftCheck }> {
  const head = await headOf(ctx.tx, writer.workspaceId)
  const yaml = proposedText(head?.yaml ?? null, proposal)
  const draft = await createDraft(ctx.tx, writer.workspaceId, {
    yaml,
    source: `${writer.channel}:${writer.actor}`.slice(0, 200),
    author: writer.actor,
    message: proposal.message?.trim() || `Proposed by ${writer.label}`,
  })
  const check = await checkDraft(ctx, writer.workspaceId, draft.yaml)
  await recordIngest(ctx, {
    workspaceId: writer.workspaceId,
    channel: writer.channel,
    actor: writer.actor,
    actorLabel: writer.label,
    action: 'propose-ontology',
    outcome: 'ok',
    detail: {
      ontology: { draftId: draft.id, classification: check.classification },
      ...(check.introduced.length ? { diagnostics: check.introduced.slice(0, 50).map(({ severity, code, message }) => ({ severity, code, message })) } : {}),
    },
    ontologyDraftId: draft.id,
    requestId: writer.requestId,
  })
  return { draft, check }
}

/** What `docket_publish_ontology_change` takes: a proposal, and what the editor's publish takes with it. */
export type DirectChange = Proposal & {
  /** The head the caller read and means to change: refused as stale when another version was published since. */
  expectedHead?: number
  migration?: Migration[]
  /** Accept resources that gain diagnostics, as the editor's "publish anyway" does. */
  acceptNarrowing?: boolean
  /** By resource id: what to do with each resource a breaking change leaves unknown. */
  dispositions?: Readonly<Record<string, Disposition>>
}

/** The caller does not hold Publish ontology changes on this docket (any more). */
export class PublishNotGranted extends OntologyWriteDisabled {
  override name = 'PublishNotGranted'
  constructor() {
    super(null)
    this.message = 'you do not hold Publish ontology changes on this docket'
  }
}

/**
 * `docket_publish_ontology_change`: publishes a proposal as the next version,
 * through the editor's publish path - the same change check, migration of
 * the documents, dispositions and activity record, with no review. Allowed
 * only while the caller holds Publish ontology changes on the docket:
 * `mayPublish` is asked again once the publish holds its locks (the head,
 * then the workspace row, in the order `publish` takes them), so a grant
 * taken away before then refuses it. Rolled back like any version, from the
 * history.
 */
export async function publishOntologyChange(ctx: StoreContext, writer: Writer, mayPublish: () => Promise<boolean>, change: DirectChange): Promise<Published> {
  const head = await lockOntologyHead(ctx, writer.workspaceId, 'update')
  await ctx.tx.query('SELECT 1 FROM workspaces WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [writer.workspaceId])
  if (!(await mayPublish())) throw new PublishNotGranted()
  const message = change.message?.trim() || `Published by ${writer.label}`
  const draft = await createDraft(ctx.tx, writer.workspaceId, {
    yaml: proposedText(head?.yaml ?? null, change),
    source: `${writer.channel}:${writer.actor}`.slice(0, 200),
    author: writer.actor,
    message,
  })
  return publish(ctx, writer.workspaceId, draft.id, {
    expectedHead: change.expectedHead ?? head?.number ?? 0,
    ...(change.migration ? { migration: change.migration } : {}),
    ...(change.acceptNarrowing ? { acceptNarrowing: true } : {}),
    ...(change.dispositions ? { dispositions: change.dispositions } : {}),
    publisher: { actor: writer.actor, login: writer.label },
    message,
    requestId: writer.requestId,
  })
}
