// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { answerSegments, citedSources, referencesIn, resolveRef, sourceKey } from './agent'
import { agentWithout, WORKSPACE_DELETED, type AgentAnswer, type AnswerSource } from './model'

const source = (workspace: string, id: string, title = id): AnswerSource => ({ workspace, id, title, type: id.split('.')[0] ?? '', cited: false, stale: false, foundBy: [] })
const orders = source('acme', 'service.orders', 'Orders')
const mirrored = source('mirror', 'service.orders', 'Orders (mirror)')
const payments = source('acme', 'team.payments', 'Payments')
const sources = [orders, mirrored, payments]

describe("the agent answer's record references", () => {
  it('names a record by id, or by docket/id when ids repeat across dockets', () => {
    expect(resolveRef('service.orders', sources)).toBe(orders)
    expect(resolveRef('mirror/service.orders', sources)).toBe(mirrored)
    expect(resolveRef('acme/team.payments', sources)).toBe(payments)
    expect(resolveRef('service.ghost', sources)).toBeNull()
    expect(resolveRef('nowhere/team.payments', sources)).toBeNull()
    expect(sourceKey(mirrored)).toBe('mirror/service.orders')
  })

  it('splits prose into words and the citations of records it knows; other brackets stay prose', () => {
    const find = (ref: string) => resolveRef(ref, sources)
    expect(answerSegments('Payments runs it [team.payments], see [mirror/service.orders] and [1] or [service.ghost].', find)).toEqual([
      { text: 'Payments runs it ' },
      { cite: payments, ref: 'team.payments' },
      { text: ', see ' },
      { cite: mirrored, ref: 'mirror/service.orders' },
      { text: ' and [1] or [service.ghost].' },
    ])
  })

  it("reads every reference in a parsed answer, in reading order: components' ids and prose citations", () => {
    const element = (typeName: string, props: Record<string, unknown>) => ({ type: 'element', typeName, props })
    const root = element('Answer', {
      children: [
        element('Prose', { text: 'Run by Payments [team.payments].' }),
        element('RecordCard', { id: 'service.orders', note: 'Depends on [service.ledger].' }),
        element('Table', { columns: ['Owner'], rows: [element('Row', { id: 'mirror/service.orders', cells: ['[team.payments]'] })] }),
        element('Heading', { text: 'Not a citation [team.ghost]' }),
      ],
    })
    expect(referencesIn(root)).toEqual(['team.payments', 'service.orders', 'service.ledger', 'mirror/service.orders', 'team.payments'])
  })

  it('cites each record once, in the order first cited, and names the references to no record', () => {
    expect(citedSources(['team.payments', 'service.orders', 'service.ghost', 'acme/team.payments', 'service.ghost'], sources)).toEqual({
      cited: [payments, orders],
      unknown: ['service.ghost'],
    })
  })
})

describe("a deleted docket's part of an agent answer", () => {
  const answer: AgentAnswer = {
    ui: 'root = Answer([p])\np = Prose("x")',
    model: 'm',
    notice: null,
    error: null,
    steps: [
      { tool: 'docket_search', workspace: 'acme', input: 'orders', result: '1 record', state: 'done', ms: 4 },
      { tool: 'docket_search', workspace: 'mirror', input: 'orders', result: '1 record', state: 'done', ms: 4 },
    ],
    sources: [orders, mirrored],
    workspaces: [
      { slug: 'acme', name: 'Acme' },
      { slug: 'mirror', name: 'Mirror' },
      { slug: 'quiet', name: 'Quiet' },
    ],
    costUsd: 0.01,
  }

  it('takes the whole answer when it looked there, keeping the other dockets’ steps and records', () => {
    expect(agentWithout(answer, new Set(['mirror']))).toEqual({
      ...answer,
      ui: null,
      error: WORKSPACE_DELETED,
      steps: [answer.steps[0]],
      sources: [orders],
      workspaces: [answer.workspaces[0], answer.workspaces[2]],
    })
  })

  it('keeps the answer when it never looked there, and drops it when every docket asked is gone', () => {
    expect(agentWithout(answer, new Set(['quiet']))).toEqual({ ...answer, workspaces: answer.workspaces.slice(0, 2) })
    expect(agentWithout(answer, new Set(['acme', 'mirror', 'quiet']))).toBeNull()
  })
})
