// SPDX-License-Identifier: AGPL-3.0-only
import type { TurnMessage } from '@docket/platform-ai'
import { appendChatMessages, createChat, readChat } from '@docket/platform-canonical-store'
import { askLimits, rateLimitMessage } from '@docket/platform-limits'
import type { RequestEvent } from '@sveltejs/kit'

import {
  MAX_QUESTION,
  agentWithout,
  chosenWorkspaces,
  isAgentAnswer,
  survivingAnswers,
  type AgentAnswerBody,
  type AnswerBody,
  type ChatBody,
  type QuestionBody,
} from '$lib/ask/model'

import { askAcross } from './ask'
import { runAgent, type AgentEvent } from './ask-agent'
import { agentDeps, askDeps, orgWorkspaces } from './ask-runtime'
import { recordAudit, recordStandalone, type OrgAccess } from './request'
import { getRuntime } from './runtime'
import { inOrg } from './workspace'

/**
 * Asking on the Ask page, for the streamed ask and the plain form alike: the
 * question checked and rate limited, answered by the agent - or, where no
 * model can be asked, by each docket's grounded `docket_ask` - and saved to
 * the member's chat with its audit event in one transaction.
 */

export interface Question {
  question: string
  /** The member's chat this follows up, or empty for a new one. */
  chatId: string
  /** The slugs of the dockets asked. */
  workspaces: string[]
}

export type Asked = { chat: string } | { status: number; problem: string }

/** Earlier turns of a chat the agent reads as context, newest last. */
const HISTORY_TURNS = 3
const HISTORY_CHARS = 4_000

/** The chat so far as the agent reads it: the last few questions and answers. */
export function chatHistory(messages: readonly { role: string; body: ChatBody }[]): TurnMessage[] {
  const turns: TurnMessage[] = messages.map(({ body }): TurnMessage => {
    if ('text' in body) return { role: 'user', content: body.text }
    const text = isAgentAnswer(body)
      ? (body.agent.ui ?? body.agent.notice ?? body.agent.error ?? '')
      : body.answers.map((part) => `${part.workspace.slug}: ${part.text ?? part.notice ?? part.error ?? ''}`).join('\n\n')
    return { role: 'assistant', content: text.length > HISTORY_CHARS ? `${text.slice(0, HISTORY_CHARS)}…` : text }
  })
  return turns.slice(-HISTORY_TURNS * 2)
}

export async function askQuestion(
  event: RequestEvent,
  access: OrgAccess,
  userId: string,
  input: Question,
  emit: (event: AgentEvent) => void = () => undefined,
): Promise<Asked> {
  const question = input.question.trim()
  const workspaces = chosenWorkspaces(await orgWorkspaces(access), input.workspaces)
  if (!question) return { status: 400, problem: 'Ask something: the question is empty.' }
  if (question.length > MAX_QUESTION) return { status: 400, problem: `Keep the question under ${MAX_QUESTION} characters.` }
  if (workspaces.length === 0) return { status: 400, problem: 'Choose at least one docket to ask.' }
  // A follow-up goes to one of the member's own chats; refused before it spends anything.
  const chat = input.chatId ? await inOrg(access, (ctx) => readChat<ChatBody>(ctx, userId, input.chatId)) : null
  if (input.chatId && !chat) return { status: 404, problem: 'Not found' }

  // At most 20 questions a minute per person, however many workspaces each goes to.
  const decision = await getRuntime().limiter.check(askLimits(userId))
  if (!decision.allowed) {
    await recordStandalone(event, { action: 'ask.question', outcome: 'denied', orgId: access.org.id, target: ['rate-limit'] })
    return { status: 429, problem: rateLimitMessage(decision) }
  }

  const started = performance.now()
  const outcome = await runAgent(agentDeps(access, userId), workspaces, question, chatHistory(chat?.messages ?? []), emit)
  // No model to ask: each docket's grounded answer, as before the agent.
  const answers = 'unavailable' in outcome ? await askAcross(askDeps(access, userId), workspaces, question) : null
  const tookMs = Math.round(performance.now() - started)
  const asked: QuestionBody = { text: question, workspaces: workspaces.map(({ slug, name }) => ({ slug, name })) }

  const saved = await inOrg(access, async (ctx) => {
    const { rows } = await ctx.tx.query<{ id: string }>('SELECT id FROM workspaces WHERE id = ANY($1) AND deleted_at IS NULL FOR SHARE', [workspaces.map((workspace) => workspace.id)])
    const existing = new Set(rows.map((row) => row.id))
    const kept = workspaces.filter((workspace) => existing.has(workspace.id))
    let answered: AnswerBody | AgentAnswerBody
    let failed: boolean
    if (answers) {
      const surviving = survivingAnswers(workspaces, answers, existing)
      if (surviving.answers.length === 0) return 'gone' as const
      answered = { answers: surviving.answers, tookMs }
      failed = surviving.answers.every((answer) => answer.error)
    } else {
      if (!('answered' in outcome)) return 'gone' as const
      // A docket deleted while the agent worked takes what it contributed with it.
      const agent = agentWithout(outcome.answered, new Set(workspaces.filter((workspace) => !existing.has(workspace.id)).map((workspace) => workspace.slug)))
      if (!agent) return 'gone' as const
      answered = { agent, tookMs }
      failed = agent.ui === null
    }
    const ids = kept.map((workspace) => workspace.id)
    const id = input.chatId || (await createChat(ctx, { userId, workspaceIds: ids, title: question }))
    const appended = await appendChatMessages(ctx, {
      userId,
      chatId: id,
      workspaceIds: ids,
      messages: [
        { role: 'user', body: asked },
        { role: 'assistant', body: answered },
      ],
    })
    if (!appended) return null
    await recordAudit(ctx.tx, event, {
      action: 'ask.question',
      orgId: access.org.id,
      outcome: failed ? 'error' : 'ok',
      target: ids,
      args: { question, workspaces: ids },
    })
    return id
  })
  if (saved === 'gone') return { status: 409, problem: 'The dockets asked were deleted while answering.' }
  if (!saved) return { status: 404, problem: 'Not found' }
  return { chat: saved }
}
