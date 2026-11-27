// SPDX-License-Identifier: AGPL-3.0-only
import { QueryError, type QueryClient, type TurnQuery, type TurnResponse } from '@docket/platform-mcp-tools'
import { TEMPLATES, contentsOf, type StartingPoint } from '@docket/platform-ontology-service'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import { DRAFT_PROBLEMS, draftOntology } from './ontology-draft'

const points: StartingPoint[] = TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, types: contentsOf(t.yaml).types, yaml: t.yaml }))
const deps = (turn: (query: TurnQuery) => Promise<TurnResponse>) => ({
  query: { turn: vi.fn(turn), search: vi.fn(), ask: vi.fn() } as unknown as QueryClient,
  orgId: 'orga',
  actor: 'user:u1',
  userId: 'u1',
})
const called = (args: unknown): TurnResponse => ({
  content: '',
  toolCalls: [{ id: 'c1', name: 'draft_ontology', arguments: JSON.stringify(args) }],
  model: 'anthropic/claude-sonnet-5.5',
  costUsd: 0.01,
})

describe("drafting a new docket's ontology", () => {
  it("asks the org's model, metered as `ontology`, and builds the draft over the template it chose", async () => {
    const d = deps(async () =>
      called({
        template: 'crm',
        summary: 'A vet clinic.',
        types: [
          { name: 'pet', description: 'An animal we treat.', attributes: [{ name: 'species', type: 'string' }] },
          { name: 'account', description: 'An owner.' },
        ],
        relationships: [{ name: 'owned_by', description: 'Whose pet.', from: ['pet'], to: ['account'] }],
      }),
    )
    const drafted = await draftOntology(d, 'Our vet clinic: pets and their owners.', points)
    if (!drafted.ok) throw new Error(drafted.problem)
    expect(drafted.template.id).toBe('crm')
    expect(drafted.summary).toBe('A vet clinic.')
    expect(Object.keys(parse(drafted.yaml).resourceTypes)).toEqual(['pet', 'account'])
    expect(d.query.turn).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'orga', actor: 'user:u1', userId: 'u1', purpose: 'ontology', tools: [expect.objectContaining({ name: 'draft_ontology' })] }),
    )
  })

  it.each([
    ['no AI service on this server', async () => Promise.reject(new QueryError(503, 'The search index is not running on this server.')), DRAFT_PROBLEMS.offline],
    ['AI not set up for the org', async () => ({ unavailable: 'not-configured', notice: 'x' }) as const, DRAFT_PROBLEMS.notConfigured],
    ['the budget spent', async () => ({ unavailable: 'cap-reached', notice: 'x' }) as const, DRAFT_PROBLEMS.capReached],
    ['the model failing', async () => Promise.reject(new QueryError(502, 'The model could not answer just now.')), DRAFT_PROBLEMS.failed],
    ['an answer that is not an ontology', async () => ({ content: 'Sorry, I cannot.', toolCalls: [], model: 'm', costUsd: 0 }), DRAFT_PROBLEMS.unreadable],
  ] as const)('says so plainly on %s', async (_, turn, problem) => {
    expect(await draftOntology(deps(turn as (query: TurnQuery) => Promise<TurnResponse>), 'Anything.', points)).toEqual({ ok: false, problem })
  })
})
