// SPDX-License-Identifier: AGPL-3.0-only
import { deleteChat, listChats, readChat } from '@docket/platform-canonical-store'
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit'

import { MAX_QUESTION, chosenWorkspaces, facets, type ChatBody } from '$lib/ask/model'
import { ASK_SCOPE_COOKIE, askScope, remember } from '$lib/ask/scope'
import { searchAcross, type SearchOutcome } from '$lib/server/ask'
import { askQuestion } from '$lib/server/ask-chat'
import { askDeps as deps, orgWorkspaces, typeRanks } from '$lib/server/ask-runtime'
import { authoriseAnywhere, orgAccess, recordAudit, requireUser } from '$lib/server/request'
import { formText, inOrg } from '$lib/server/workspace'

/**
 * The Ask page, in the casebook (`/o/{org}/ask`) or a docket's Chat tab
 * (`/o/{org}/w/{ws}/ask`): a member's questions to one or more of the org's
 * workspaces, answered by the agent over each docket's MCP tools (streamed
 * from `/o/{org}/ask/stream`; `?/ask` without script) and saved as their
 * chats, and the direct search over the same workspaces. The workspaces
 * offered are those the member reaches: their account role's, or the ones
 * they were granted. A Chat tab asks its docket alone and lists only the
 * chats asking it alone.
 */

/** The docket a Chat tab is fixed to, from its route; null in the casebook. */
const docketOf = (event: RequestEvent) => event.params.ws ?? null

/** The page's address with `params`: the docket's Chat tab, or the casebook's Ask. */
const page = (org: string, docket: string | null, params: Record<string, string | string[]> = {}) => {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) for (const one of [value].flat()) search.append(name, one)
  const query = search.toString()
  return `/o/${org}${docket ? `/w/${docket}` : ''}/ask${query ? `?${query}` : ''}`
}

export async function loadAsk(event: RequestEvent) {
  const access = await orgAccess(event)
  authoriseAnywhere(access, 'read')
  const user = requireUser(event)
  const params = event.url.searchParams
  const workspaces = await orgWorkspaces(access)
  const slug = docketOf(event)
  const docket = slug ? workspaces.find((workspace) => workspace.slug === slug) : null
  if (slug && !docket) error(404, 'Not found')
  const chatId = params.get('chat')
  const [chats, chat] = await inOrg(
    access,
    async (ctx) => [await listChats(ctx, user.id, docket ? { workspaceId: docket.id } : {}), chatId ? await readChat<ChatBody>(ctx, user.id, chatId) : null] as const,
  )
  if (chatId && !chat) error(404, 'Not found')
  // A chat asking more than this docket opens in the casebook's Ask, where its scope can be seen.
  if (docket && chat && !(chat.workspaceIds.length === 1 && chat.workspaceIds[0] === docket.id)) redirect(303, page(access.org.slug, null, { chat: chat.id }))

  const all = workspaces.map((workspace) => workspace.slug)
  const named = params.getAll('ws')
  const fromChat = chat ? workspaces.filter((workspace) => chat.workspaceIds.includes(workspace.id)).map((workspace) => workspace.slug) : []
  const cookie = { path: `/o/${access.org.slug}`, httpOnly: false, sameSite: 'lax' as const, secure: event.url.protocol === 'https:', maxAge: 60 * 60 * 24 * 365 }
  const selected = chosenWorkspaces(
    workspaces,
    askScope({ all, docket: docket?.slug, named, chat: fromChat, remembered: event.cookies.get(ASK_SCOPE_COOKIE) ?? null }),
  )
  // The casebook's Ask remembers a scope its address names, so the next visit and New chat keep it.
  const remembered = !docket && named.length ? remember(all, named) : null
  if (remembered) event.cookies.set(ASK_SCOPE_COOKIE, remembered, cookie)

  const mode = params.get('mode') === 'search' ? 'search' : 'chat'
  const query = (params.get('q') ?? '').trim().slice(0, MAX_QUESTION)
  const filters = { types: params.getAll('type').filter(Boolean), tags: params.getAll('tag').filter(Boolean) }
  const searching = mode === 'search' && selected.length > 0 && (query !== '' || filters.types.length > 0 || filters.tags.length > 0)
  let search: { result: SearchOutcome | null; facets: SearchOutcome['facets'] } | null = null
  if (mode === 'search') {
    // Read once: the search and the filters' counts both come from the selected workspaces' documents.
    const asking = deps(access, user.id)
    const graphs = await asking.graphs(selected)
    const result = searching ? await searchAcross({ ...asking, graphs: async () => graphs }, selected, query, filters) : null
    search = { result, facets: result?.facets ?? facets(selected.flatMap((workspace) => graphs.get(workspace.slug)?.entities ?? [])) }
  }
  return {
    workspaces: workspaces.map(({ slug, name }) => ({ slug, name })),
    slots: await typeRanks(access, workspaces),
    /** The docket a Chat tab asks alone; null in the casebook's Ask. */
    docket: docket ? { slug: docket.slug, name: docket.name } : null,
    selected: selected.map((workspace) => workspace.slug),
    mode,
    chats: chats.map((summary) => ({ id: summary.id, title: summary.title, updatedAt: summary.updatedAt.toISOString() })),
    chat: chat
      ? {
          id: chat.id,
          title: chat.title,
          messages: chat.messages.map((message) => ({ seq: message.seq, role: message.role, body: message.body, at: message.createdAt.toISOString() })),
        }
      : null,
    search: { query, filters, view: params.get('view') === 'graph' ? 'graph' : 'list', result: search?.result ?? null, facets: search?.facets ?? null },
  }
}

/** Asks without script: the answer opens in its chat on this page. A Chat tab asks its docket whatever the form names. */
async function ask(event: RequestEvent) {
  const access = await orgAccess(event)
  authoriseAnywhere(access, 'read')
  const user = requireUser(event)
  const form = await event.request.formData()
  const question = formText(form, 'question')
  const docket = docketOf(event)
  const asked = await askQuestion(event, access, user.id, { question, chatId: String(form.get('chat') ?? ''), workspaces: docket ? [docket] : form.getAll('ws').map(String) })
  if ('chat' in asked) redirect(303, page(access.org.slug, docket, { chat: asked.chat }))
  if (asked.status === 404) error(404, 'Not found')
  return fail(asked.status, { problem: asked.problem, question: question.trim() })
}

/** Deletes one of the member's own chats. */
async function remove(event: RequestEvent) {
  const access = await orgAccess(event)
  authoriseAnywhere(access, 'read')
  const user = requireUser(event)
  const chatId = String((await event.request.formData()).get('chat') ?? '')
  const deleted = await inOrg(access, async (ctx) => {
    const done = await deleteChat(ctx, user.id, chatId)
    if (done) await recordAudit(ctx.tx, event, { action: 'ask.chat.delete', orgId: access.org.id, target: [chatId] })
    return done
  })
  if (!deleted) return fail(404, { problem: 'That chat is not there any more.' })
  redirect(303, page(access.org.slug, docketOf(event)))
}

export const askActions = { ask, delete: remove }
