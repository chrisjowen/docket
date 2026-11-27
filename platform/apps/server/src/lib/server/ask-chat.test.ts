// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import type { AgentAnswer, ChatBody } from '$lib/ask/model'

import { chatHistory } from './ask-chat'

const agent = (ui: string | null, notice: string | null = null): AgentAnswer => ({ ui, model: 'm', notice, error: null, steps: [], sources: [], workspaces: [], costUsd: 0 })
const question = (text: string): ChatBody => ({ text, workspaces: [{ slug: 'acme', name: 'Acme' }] })

describe("a chat's history, as the agent reads a follow-up", () => {
  it('gives the last questions and answers of either kind, newest last', () => {
    const messages: { role: string; body: ChatBody }[] = [
      { role: 'user', body: question('first?') },
      { role: 'assistant', body: { answers: [{ workspace: { slug: 'acme', name: 'Acme' }, text: 'Memo text', model: null, notice: null, error: null, sources: [], unavailable: [] }] } },
      { role: 'user', body: question('second?') },
      { role: 'assistant', body: { agent: agent('root = Answer([])') } },
      { role: 'user', body: question('third?') },
      { role: 'assistant', body: { agent: agent(null, 'AI budget reached.') } },
      { role: 'user', body: question('fourth?') },
      { role: 'assistant', body: { agent: agent(`root = Answer([p])\np = Prose("${'x'.repeat(5_000)}")`) } },
    ]
    const history = chatHistory(messages)
    expect(history.map((turn) => [turn.role, turn.content.slice(0, 20)])).toEqual([
      ['user', 'second?'],
      ['assistant', 'root = Answer([])'],
      ['user', 'third?'],
      ['assistant', 'AI budget reached.'],
      ['user', 'fourth?'],
      ['assistant', 'root = Answer([p])\np'],
    ])
    expect(history.at(-1)?.content.length).toBe(4_001)
    expect(chatHistory(messages.slice(0, 2)).at(-1)?.content).toBe('acme: Memo text')
  })
})
