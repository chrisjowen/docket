// SPDX-License-Identifier: AGPL-3.0-only
import { decryptText, encrypt } from '@docket/platform-keys'

import { documentAad, type StoreContext } from './documents.js'

/**
 * Saved chats (the Ask page): a member's questions to one or more of the
 * org's workspaces, with the answers they got. A chat is its member's alone:
 * every read and delete names the user, and another member's chat is not
 * found. Titles and messages are customer content, so they are encrypted
 * under the org's data key, bound to the chat and the message's place in it.
 */
export type ChatRole = 'user' | 'assistant'

export interface ChatMessage<Body = Record<string, unknown>> {
  role: ChatRole
  body: Body
}

export interface StoredChatMessage<Body = Record<string, unknown>> extends ChatMessage<Body> {
  seq: number
  createdAt: Date
}

export interface ChatSummary {
  id: string
  title: string
  workspaceIds: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Chat<Body = Record<string, unknown>> extends ChatSummary {
  messages: StoredChatMessage<Body>[]
}

/** The longest title kept: the first question, cut. */
export const CHAT_TITLE_MAX = 120
/** The most chats a member's list shows. */
export const CHATS_LISTED = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const titleAad = (orgId: string, chatId: string) => documentAad({ orgId, workspaceId: 'chats', documentId: `chat:${chatId}`, revision: 0 })
const messageAad = (orgId: string, chatId: string, seq: number) =>
  documentAad({ orgId, workspaceId: 'chats', documentId: `chat:${chatId}`, revision: seq })

/** A chat's title from its first question: one line, at most `CHAT_TITLE_MAX` characters. */
export function chatTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length <= CHAT_TITLE_MAX ? line : `${line.slice(0, CHAT_TITLE_MAX - 1).trimEnd()}…`
}

async function seal(ctx: StoreContext, text: string, aad: string) {
  const out = await encrypt(ctx.keys.key(), text, aad)
  return { ciphertext: Buffer.from(out.ciphertext), nonce: Buffer.from(out.nonce), version: ctx.keys.version }
}

async function open(ctx: StoreContext, row: { ciphertext: Buffer; nonce: Buffer; version: number }, aad: string): Promise<string> {
  return decryptText(ctx.keys.key(row.version), { ciphertext: new Uint8Array(row.ciphertext), nonce: new Uint8Array(row.nonce) }, aad)
}

type ChatRow = {
  id: string
  workspace_ids: string[]
  title_ciphertext: Buffer
  title_nonce: Buffer
  dek_version: number
  created_at: Date
  updated_at: Date
}

async function toSummary(ctx: StoreContext, row: ChatRow): Promise<ChatSummary> {
  let title: string
  try {
    title = await open(ctx, { ciphertext: row.title_ciphertext, nonce: row.title_nonce, version: row.dek_version }, titleAad(ctx.keys.orgId, row.id))
  } catch {
    title = 'Untitled chat'
  }
  return { id: row.id, title, workspaceIds: row.workspace_ids, createdAt: row.created_at, updatedAt: row.updated_at }
}

/** Starts a chat for `userId` over `workspaceIds`, titled by its first question. */
export async function createChat(ctx: StoreContext, input: { userId: string; workspaceIds: string[]; title: string }): Promise<string> {
  const { rows } = await ctx.tx.query<{ id: string }>('SELECT gen_random_uuid()::text AS id')
  const id = rows[0]?.id
  if (!id) throw new Error('no chat id')
  const title = await seal(ctx, chatTitle(input.title), titleAad(ctx.keys.orgId, id))
  await ctx.tx.query(
    `INSERT INTO chats (id, user_id, workspace_ids, asked_workspace_ids, title_ciphertext, title_nonce, dek_version) VALUES ($1, $2, $3, $3, $4, $5, $6)`,
    [id, input.userId, input.workspaceIds, title.ciphertext, title.nonce, title.version],
  )
  return id
}

/** The member's chats, most recently used first; with `workspaceId`, only those asking that workspace alone. */
export async function listChats(ctx: StoreContext, userId: string, options: { workspaceId?: string } = {}): Promise<ChatSummary[]> {
  const only = options.workspaceId === undefined ? '' : 'AND workspace_ids = ARRAY[$2]::text[]'
  const { rows } = await ctx.tx.query<ChatRow>(
    `SELECT id, workspace_ids, title_ciphertext, title_nonce, dek_version, created_at, updated_at
       FROM chats WHERE user_id = $1 ${only} ORDER BY updated_at DESC, id LIMIT ${CHATS_LISTED}`,
    options.workspaceId === undefined ? [userId] : [userId, options.workspaceId],
  )
  return Promise.all(rows.map((row) => toSummary(ctx, row)))
}

/** One of the member's chats with its messages in order, or null when it is not theirs or not there. */
export async function readChat<Body = Record<string, unknown>>(ctx: StoreContext, userId: string, chatId: string): Promise<Chat<Body> | null> {
  if (!UUID.test(chatId)) return null
  const { rows } = await ctx.tx.query<ChatRow>(
    'SELECT id, workspace_ids, title_ciphertext, title_nonce, dek_version, created_at, updated_at FROM chats WHERE id = $1 AND user_id = $2',
    [chatId, userId],
  )
  const row = rows[0]
  if (!row) return null
  const messages = await ctx.tx.query<{ seq: number; role: ChatRole; body_ciphertext: Buffer; body_nonce: Buffer; dek_version: number; created_at: Date }>(
    'SELECT seq, role, body_ciphertext, body_nonce, dek_version, created_at FROM chat_messages WHERE chat_id = $1 ORDER BY seq',
    [chatId],
  )
  return {
    ...(await toSummary(ctx, row)),
    messages: await Promise.all(
      messages.rows.map(async (message) => ({
        seq: message.seq,
        role: message.role,
        body: JSON.parse(
          await open(ctx, { ciphertext: message.body_ciphertext, nonce: message.body_nonce, version: message.dek_version }, messageAad(ctx.keys.orgId, chatId, message.seq)),
        ) as Body,
        createdAt: message.created_at,
      })),
    ),
  }
}

/**
 * Appends messages to one of the member's chats and records the workspaces it
 * now asks. False when the chat is not theirs or not there.
 */
export async function appendChatMessages(
  ctx: StoreContext,
  input: { userId: string; chatId: string; workspaceIds: string[]; messages: ChatMessage<unknown>[] },
): Promise<boolean> {
  if (!UUID.test(input.chatId)) return false
  // Held for the append, so two answers landing at once take the next numbers in turn.
  const { rows } = await ctx.tx.query<{ last: number }>(
    `SELECT coalesce((SELECT max(seq) FROM chat_messages WHERE chat_id = c.id), 0) AS last
       FROM chats c WHERE c.id = $1 AND c.user_id = $2 FOR UPDATE`,
    [input.chatId, input.userId],
  )
  const found = rows[0]
  if (!found) return false
  let seq = found.last
  for (const message of input.messages) {
    seq += 1
    const body = await seal(ctx, JSON.stringify(message.body), messageAad(ctx.keys.orgId, input.chatId, seq))
    await ctx.tx.query(
      'INSERT INTO chat_messages (chat_id, seq, role, body_ciphertext, body_nonce, dek_version) VALUES ($1, $2, $3, $4, $5, $6)',
      [input.chatId, seq, message.role, body.ciphertext, body.nonce, body.version],
    )
  }
  await ctx.tx.query(
    `UPDATE chats SET workspace_ids = $2, updated_at = now(),
            asked_workspace_ids = ARRAY(SELECT DISTINCT unnest(asked_workspace_ids || $2::text[]))
      WHERE id = $1`,
    [input.chatId, input.workspaceIds],
  )
  return true
}

/** Deletes one of the member's chats and its messages. False when it is not theirs or not there. */
export async function deleteChat(ctx: StoreContext, userId: string, chatId: string): Promise<boolean> {
  if (!UUID.test(chatId)) return false
  const { rowCount } = await ctx.tx.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [chatId, userId])
  return (rowCount ?? 0) > 0
}

/** What a deleted workspace's part of a saved answer becomes. */
export const WORKSPACE_DELETED_MARKER = 'Source removed - workspace deleted'

/** One workspace's part of a saved answer, as the Ask page writes it: `{ workspace: { slug, name }, ... }`. */
type AnswerPart = { workspace?: { slug?: unknown; name?: unknown } } & Record<string, unknown>

const partsOf = (body: unknown): AnswerPart[] | null => {
  const answers = (body as { answers?: unknown } | null)?.answers
  return Array.isArray(answers) ? (answers as AnswerPart[]) : null
}

/** The Ask page agent's saved answer: one answer over every docket asked, with the steps and records each gave. */
type AgentPart = {
  workspaces?: { slug?: unknown }[]
  steps?: { workspace?: unknown }[]
  sources?: { workspace?: unknown }[]
} & Record<string, unknown>

const agentOf = (body: unknown): AgentPart | null => {
  const agent = (body as { agent?: unknown } | null)?.agent
  return typeof agent === 'object' && agent !== null && !Array.isArray(agent) ? (agent as AgentPart) : null
}

/**
 * An agent's answer without `slug`: 'gone' when it asked only that workspace;
 * otherwise its steps and records there go, and so does the answer itself if
 * it looked there at all, since its words cannot be told apart by workspace.
 * Null when it never asked that workspace.
 */
function agentWithout(agent: AgentPart, slug: string): AgentPart | 'gone' | null {
  const asked = agent.workspaces ?? []
  if (!asked.some((workspace) => workspace.slug === slug)) return null
  if (asked.every((workspace) => workspace.slug === slug)) return 'gone'
  const workspaces = asked.filter((workspace) => workspace.slug !== slug)
  const touched = (agent.steps ?? []).some((step) => step.workspace === slug) || (agent.sources ?? []).some((source) => source.workspace === slug)
  if (!touched) return { ...agent, workspaces }
  return {
    ...agent,
    ui: null,
    notice: null,
    error: WORKSPACE_DELETED_MARKER,
    steps: (agent.steps ?? []).filter((step) => step.workspace !== slug),
    sources: (agent.sources ?? []).filter((source) => source.workspace !== slug),
    workspaces,
    removed: true,
  }
}

/**
 * Removes what a workspace contributed to every chat that asked it, for
 * `deleteWorkspace`, in its transaction: an answer that drew only on that
 * workspace goes, with the question it answered; in an answer from several,
 * that workspace's part - its text, source titles and ids - becomes
 * `WORKSPACE_DELETED_MARKER`. An agent's answer over several workspaces is
 * one text, so when it looked in that workspace the whole answer becomes the
 * marker, keeping only the other workspaces' steps and records. A chat left
 * with nothing goes too, and the workspace leaves every chat's workspaces.
 */
export async function purgeWorkspaceFromChats(
  ctx: StoreContext,
  workspace: { id: string; slug: string },
): Promise<{ deletedMessages: number; redactedMessages: number; deletedChats: number }> {
  const done = { deletedMessages: 0, redactedMessages: 0, deletedChats: 0 }
  const { rows: chats } = await ctx.tx.query<{ id: string }>('SELECT id FROM chats WHERE asked_workspace_ids @> ARRAY[$1]::text[] FOR UPDATE', [workspace.id])
  for (const chat of chats) {
    const { rows } = await ctx.tx.query<{ seq: number; role: ChatRole; body_ciphertext: Buffer; body_nonce: Buffer; dek_version: number }>(
      'SELECT seq, role, body_ciphertext, body_nonce, dek_version FROM chat_messages WHERE chat_id = $1 ORDER BY seq',
      [chat.id],
    )
    const doomed = new Set<number>()
    for (const [index, row] of rows.entries()) {
      if (row.role !== 'assistant') continue
      const body = JSON.parse(
        await open(ctx, { ciphertext: row.body_ciphertext, nonce: row.body_nonce, version: row.dek_version }, messageAad(ctx.keys.orgId, chat.id, row.seq)),
      ) as Record<string, unknown>
      const question = rows[index - 1]
      const doom = () => {
        doomed.add(row.seq)
        if (question?.role === 'user') doomed.add(question.seq)
      }
      let rewritten: Record<string, unknown>
      const agent = agentOf(body)
      if (agent) {
        const kept = agentWithout(agent, workspace.slug)
        if (kept === null) continue
        if (kept === 'gone') {
          doom()
          continue
        }
        rewritten = { ...body, agent: kept }
      } else {
        const parts = partsOf(body)
        if (!parts || !parts.some((part) => part.workspace?.slug === workspace.slug)) continue
        if (parts.every((part) => part.workspace?.slug === workspace.slug)) {
          doom()
          continue
        }
        const redacted = parts.map((part) =>
          part.workspace?.slug === workspace.slug
            ? { workspace: part.workspace, text: null, model: null, notice: null, error: WORKSPACE_DELETED_MARKER, sources: [], unavailable: [], removed: true }
            : part,
        )
        rewritten = { ...body, answers: redacted }
      }
      const sealed = await seal(ctx, JSON.stringify(rewritten), messageAad(ctx.keys.orgId, chat.id, row.seq))
      await ctx.tx.query('UPDATE chat_messages SET body_ciphertext = $3, body_nonce = $4, dek_version = $5 WHERE chat_id = $1 AND seq = $2', [
        chat.id,
        row.seq,
        sealed.ciphertext,
        sealed.nonce,
        sealed.version,
      ])
      done.redactedMessages += 1
    }
    if (doomed.size > 0) {
      await ctx.tx.query('DELETE FROM chat_messages WHERE chat_id = $1 AND seq = ANY($2::int[])', [chat.id, [...doomed]])
      done.deletedMessages += doomed.size
    }
    if (doomed.size === rows.length) {
      await ctx.tx.query('DELETE FROM chats WHERE id = $1', [chat.id])
      done.deletedChats += 1
    } else {
      await ctx.tx.query(
        `UPDATE chats SET workspace_ids = array_remove(workspace_ids, $2), asked_workspace_ids = array_remove(asked_workspace_ids, $2) WHERE id = $1`,
        [chat.id, workspace.id],
      )
    }
  }
  return done
}
