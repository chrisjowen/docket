// SPDX-License-Identifier: AGPL-3.0-only
import { AiCapReached, AiNotConfigured, type TurnModel } from '@docket/platform-ai'
import { describe, expect, it, vi } from 'vitest'

import { parseTurn, QueryFailure, queryService, type QueryServiceDeps } from './query.js'

const log = { info: vi.fn(), error: vi.fn() }

/** A query service whose only use here is the agent's turns. */
const service = (turns: QueryServiceDeps['turns']) => queryService({ turns, log } as unknown as QueryServiceDeps)

const turn = {
  orgId: 'orga',
  actor: 'user:u1',
  userId: 'u1',
  messages: [
    { role: 'system' as const, content: 'You look things up.' },
    { role: 'user' as const, content: 'Who owns orders?' },
  ],
  tools: [{ name: 'docket_search', description: 'Search.', parameters: { type: 'object' } }],
}

describe("the Ask page agent's turn", () => {
  it("runs on the org's metered model and says what it cost", async () => {
    const model: TurnModel = {
      turn: vi.fn(async () => ({
        content: '',
        toolCalls: [{ id: 'c1', name: 'docket_search', arguments: '{"query":"orders"}' }],
        model: 'anthropic/claude-sonnet-5.5',
        generationId: 'g1',
        usage: { promptTokens: 100, completionTokens: 10, costUsd: 0.003 },
      })),
    }
    const turns = vi.fn(() => model)
    expect(await service(turns).turn({ ...turn, toolChoice: 'auto', maxTokens: 400 })).toEqual({
      content: '',
      toolCalls: [{ id: 'c1', name: 'docket_search', arguments: '{"query":"orders"}' }],
      model: 'anthropic/claude-sonnet-5.5',
      costUsd: 0.003,
    })
    expect(turns).toHaveBeenCalledWith('orga', { actor: 'user:u1', purpose: 'agent' })
    expect(model.turn).toHaveBeenCalledWith({ messages: turn.messages, tools: turn.tools, toolChoice: 'auto', maxTokens: 400 })
  })

  it('meters a turn that drafts an ontology as `ontology`', async () => {
    const turns = vi.fn(() => null)
    await service(turns).turn({ ...turn, purpose: 'ontology' })
    expect(turns).toHaveBeenCalledWith('orga', { actor: 'user:u1', purpose: 'ontology' })
  })

  it('says why there is no model: none set up, or the budget spent', async () => {
    expect(await service(() => null).turn(turn)).toMatchObject({ unavailable: 'not-configured' })
    expect(await service(undefined).turn(turn)).toMatchObject({ unavailable: 'not-configured' })
    const refusing = (cause: Error) => () => ({ turn: async () => Promise.reject(cause) })
    expect(await service(refusing(new AiCapReached('orga', 20, 20))).turn(turn)).toMatchObject({ unavailable: 'cap-reached', notice: expect.stringContaining('AI budget') })
    expect(await service(refusing(new AiNotConfigured('orga'))).turn(turn)).toMatchObject({ unavailable: 'not-configured' })
  })

  it("fails without the model's error text when the model fails", async () => {
    const failed = service(() => ({ turn: async () => Promise.reject(new Error('upstream said: <customer text>')) })).turn(turn)
    await expect(failed).rejects.toBeInstanceOf(QueryFailure)
    await expect(service(() => ({ turn: async () => Promise.reject(new Error('x')) })).turn(turn)).rejects.toThrow('The model could not answer just now.')
  })
})

describe('a turn request', () => {
  const body = {
    ...turn,
    messages: [
      ...turn.messages,
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'docket_search', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: 'nothing' },
    ],
  }

  it('takes the conversation, its tool calls and results, and the tools', () => {
    expect(parseTurn(body)).toEqual(body)
    expect(parseTurn({ ...body, toolChoice: 'none', maxTokens: 2000 })).toEqual({ ...body, toolChoice: 'none', maxTokens: 2000 })
    expect(parseTurn({ ...body, purpose: 'ontology' })).toEqual({ ...body, purpose: 'ontology' })
  })

  it.each([
    { orgId: 'Org A' },
    { actor: '' },
    { messages: [] },
    { messages: [{ role: 'robot', content: 'x' }] },
    { messages: [{ role: 'tool', content: 'x' }] },
    { messages: [{ role: 'assistant', content: 'x', toolCalls: [{ id: 'c', name: 'Bad Name', arguments: '{}' }] }] },
    { tools: [{ name: 'docket_search', description: 'x' }] },
    { tools: 'docket_search' },
    { toolChoice: 'required' },
    { maxTokens: 0 },
    { maxTokens: 9000 },
    { purpose: 'cypher' },
  ])('refuses %j', (bad) => {
    expect(() => parseTurn({ ...body, ...bad })).toThrow(QueryFailure)
  })
})
