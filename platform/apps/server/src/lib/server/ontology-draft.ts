// SPDX-License-Identifier: AGPL-3.0-only
import { QueryError, type QueryClient } from '@docket/platform-mcp-tools'
import { DRAFT_TOOL, OntologyInvalid, buildDraft, draftMessages, readPlan, type StartingPoint } from '@docket/platform-ontology-service'

/**
 * New docket's "Describe your domain": the org's model drafts an ontology
 * from a few sentences, starting from the closest template. The model call
 * goes through the worker's query service, which holds the org's AI key,
 * checks its monthly cap and meters the call as `ontology`, as for every
 * other model call. Every way it can fail says so plainly and points back
 * to the templates.
 */

export type Drafted = { ok: true; yaml: string; template: StartingPoint; summary: string } | { ok: false; problem: string }

export const DRAFT_PROBLEMS = {
  offline: 'AI drafting is not available on this server: its AI service is not running. Start from a template instead.',
  notConfigured: 'AI is not set up for this organisation yet, so it cannot draft an ontology. Start from a template instead, or ask an owner to set up AI.',
  capReached: "This month's AI budget is spent, so AI cannot draft an ontology. Start from a template instead, or ask an owner to raise the cap.",
  failed: 'AI could not draft the ontology just now. Try again in a moment, or start from a template.',
  unreadable: 'AI did not answer with an ontology. Try again, or describe the domain in other words.',
} as const

/** The most the model may write: a draft of a dozen types with their fields. */
const MAX_TOKENS = 8_000

export async function draftOntology(
  deps: { query: QueryClient; orgId: string; actor: string; userId: string },
  description: string,
  startingPoints: readonly StartingPoint[],
): Promise<Drafted> {
  let reply: Awaited<ReturnType<QueryClient['turn']>>
  try {
    reply = await deps.query.turn({
      orgId: deps.orgId,
      actor: deps.actor,
      userId: deps.userId,
      purpose: 'ontology',
      messages: draftMessages(description, startingPoints),
      tools: [DRAFT_TOOL],
      toolChoice: 'auto',
      maxTokens: MAX_TOKENS,
    })
  } catch (caught) {
    if (caught instanceof QueryError) return { ok: false, problem: caught.status === 503 ? DRAFT_PROBLEMS.offline : DRAFT_PROBLEMS.failed }
    throw caught
  }
  if ('unavailable' in reply) return { ok: false, problem: reply.unavailable === 'cap-reached' ? DRAFT_PROBLEMS.capReached : DRAFT_PROBLEMS.notConfigured }
  const plan = readPlan(reply, startingPoints)
  const template = plan && startingPoints.find((point) => point.id === plan.template)
  if (!plan || !template) return { ok: false, problem: DRAFT_PROBLEMS.unreadable }
  try {
    return { ok: true, yaml: buildDraft(plan, template), template, summary: plan.summary }
  } catch (caught) {
    if (caught instanceof OntologyInvalid) return { ok: false, problem: DRAFT_PROBLEMS.unreadable }
    throw caught
  }
}
