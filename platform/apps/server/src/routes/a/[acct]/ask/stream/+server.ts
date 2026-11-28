// SPDX-License-Identifier: AGPL-3.0-only
import { error } from '@sveltejs/kit'

import { askQuestion, type Question } from '$lib/server/ask-chat'
import { authoriseAnywhere, orgAccess, recordStandalone, requireUser } from '$lib/server/request'

import type { RequestHandler } from './$types'

/**
 * The Ask page's streamed ask: `{ question, chat?, ws: [...] }` in, and out,
 * one JSON object a line as the agent works - `turn` as each turn of the model
 * starts, `step` as each look-up starts and ends - then `done` with the chat
 * the answer was saved to, or `problem` with why there is none. The page
 * opens the chat once it is done; without script, the form's `?/ask` answers
 * the same way, all at once.
 */
export const POST: RequestHandler = async (event) => {
  const access = await orgAccess(event, { api: true })
  authoriseAnywhere(access, 'read')
  const user = requireUser(event)
  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Send the question as JSON.')
  }
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const input: Question = {
    question: typeof raw.question === 'string' ? raw.question.replace(/\r\n/g, '\n') : '',
    chatId: typeof raw.chat === 'string' ? raw.chat : '',
    workspaces: Array.isArray(raw.ws) ? raw.ws.filter((slug): slug is string => typeof slug === 'string') : [],
  }
  // The answer and its audit event are saved together while the stream runs; a refusal records its own.
  event.locals.audited = true

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (line: unknown) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
        } catch {
          // The page went away: the answer is still saved to the chat.
          open = false
        }
      }
      try {
        const asked = await askQuestion(event, access, user.id, input, send)
        if ('chat' in asked) send({ type: 'done', chat: asked.chat })
        else {
          if (asked.status !== 429) {
            await recordStandalone(event, { action: 'ask.question', outcome: asked.status === 404 ? 'denied' : asked.status === 409 ? 'error' : 'invalid', orgId: access.org.id })
          }
          send({ type: 'problem', status: asked.status, problem: asked.problem })
        }
      } catch (cause) {
        console.error(`[${event.locals.requestId}] ask: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
        await recordStandalone(event, { action: 'ask.question', outcome: 'error', orgId: access.org.id }).catch(() => undefined)
        send({ type: 'problem', status: 500, problem: 'The question could not be answered just now. Try again.' })
      } finally {
        if (open) controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } })
}
