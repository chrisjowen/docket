// SPDX-License-Identifier: AGPL-3.0-only
import { parseOntology, type Ontology, type StoreContext } from '@docket/platform-canonical-store'
import { createDraft, headOf, proposedText, publish, type Publisher } from '@docket/platform-ontology-service'
import { isMap, parseDocument, stringify } from 'yaml'

import { CONTRADICTS_REL, DUPLICATE_REL } from './detect.js'

/** The evidence source every inference is written with. */
export const INFERRED_SOURCE = 'inferred'

const ADDITIONS = {
  source: {
    kind: 'content',
    description:
      "Inferred by Docket Cloud's background enrichment from what other documents say. The note gives the reasoning; path and symbol cite the document and resource it was read from.",
  },
  policy: { name: 'Inferred by enrichment', when: { source: INFERRED_SOURCE }, score: 0.4 },
  relationships: {
    [DUPLICATE_REL]: {
      description: 'Describes the same thing as the target, which is kept. Written by background enrichment for resources that go by the same name.',
      from: '*',
      to: '*',
    },
    [CONTRADICTS_REL]: {
      description: 'Disagrees with the target about something both state - an attribute value, say. Written by background enrichment.',
      from: '*',
      to: '*',
    },
  },
} as const

/** Whether the ontology's own text says how it is trusted in the current form, `sources:` or `trust:`, rather than the legacy `evidence:` block. */
function currentForm(yaml: string): boolean {
  const contents = parseDocument(yaml).contents
  return isMap(contents) && (contents.has('sources') || contents.has('trust'))
}

/**
 * What enrichment needs the ontology to register and it does not yet: the
 * `inferred` source with the policy that prices it, and the `duplicate_of`
 * and `contradicts` relationships. A merge patch onto the head's text, or
 * null when nothing is missing. A head still in the legacy `evidence:` form
 * is written out in the current form - its sources and policies as docket
 * reads them, so every score stays as it was - since docket reads a
 * `sources:` map beside an `evidence:` block and drops the block.
 */
export function ontologyAdditions(yaml: string): { patch: Record<string, unknown>; added: string[] } | null {
  const ontology = parseOntology(yaml).ontology
  if (!ontology) return null
  const added: string[] = []
  const patch: Record<string, unknown> = {}
  if (!ontology.sources?.[INFERRED_SOURCE]) {
    const policies = [...(ontology.trust?.policies ?? []), ADDITIONS.policy]
    if (currentForm(yaml)) {
      patch.sources = { [INFERRED_SOURCE]: ADDITIONS.source }
      patch.trust = { policies }
    } else {
      patch.sources = { ...ontology.sources, [INFERRED_SOURCE]: ADDITIONS.source }
      patch.trust = { ...ontology.trust, policies }
      patch.evidence = null
    }
    added.push(`the ${INFERRED_SOURCE} evidence source`)
  }
  const relationships: Record<string, unknown> = {}
  for (const [rel, definition] of Object.entries(ADDITIONS.relationships)) {
    if (ontology.relationships[rel]) continue
    relationships[rel] = definition
    added.push(`the ${rel} relationship`)
  }
  if (Object.keys(relationships).length) patch.relationships = relationships
  return added.length ? { patch, added } : null
}

export class NoOntology extends Error {
  override name = 'NoOntology'
  constructor() {
    super('Publish an ontology first: enrichment writes against it.')
  }
}

/**
 * Publishes what enrichment needs onto the workspace's ontology head, if
 * anything is missing, as a version of its own from the person turning
 * enrichment on. Additions only, so the change check finds it safe. Returns
 * the version it published, or null when the head already had everything.
 */
export async function ensureEnrichmentOntology(
  ctx: StoreContext,
  workspaceId: string,
  publisher: Publisher & { requestId?: string },
): Promise<{ number: number; added: string[] } | null> {
  const head = await headOf(ctx.tx, workspaceId)
  if (!head?.number) throw new NoOntology()
  if (!parseOntology(head.yaml).ontology) throw new NoOntology()
  const additions = ontologyAdditions(head.yaml)
  if (!additions) return null
  const message = `Background enrichment: add ${additions.added.join(', ')}`
  const draft = await createDraft(ctx.tx, workspaceId, {
    yaml: proposedText(head.yaml, { patch: stringify(additions.patch, { lineWidth: 0 }) }),
    source: 'enrichment',
    author: publisher.actor,
    message,
  })
  const published = await publish(ctx, workspaceId, draft.id, {
    expectedHead: head.number,
    publisher,
    message,
    ...(publisher.requestId ? { requestId: publisher.requestId } : {}),
  })
  return { number: published.number ?? head.number + 1, added: additions.added }
}

/** Whether the head registers the `inferred` source, without which every inference is refused. */
export const registersInferred = (ontology: Ontology | null | undefined): boolean => Boolean(ontology?.sources?.[INFERRED_SOURCE])
