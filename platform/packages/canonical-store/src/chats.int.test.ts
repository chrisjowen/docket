// SPDX-License-Identifier: AGPL-3.0-only
import { TEST_PG_URL } from '@docket/platform-tenancy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { WORKSPACE_DELETED_MARKER, appendChatMessages, createChat, deleteChat, deleteWorkspace, insertWorkspace, listChats, readChat } from './index.js'
import { createTestOrg, type TestOrg } from './testing.js'

describe.skipIf(!TEST_PG_URL)('saved chats', () => {
  let org: TestOrg
  let workspaceId: string

  beforeAll(async () => {
    org = await createTestOrg()
    workspaceId = await org.withOrg(async (ctx) => (await insertWorkspace(ctx.tx, { name: 'Platform', slug: 'platform', createdBy: org.userId })).id)
  })
  afterAll(() => org?.drop())

  it('keeps a member’s questions and answers in order, encrypted at rest', async () => {
    const id = await org.withOrg(async (ctx) => {
      const chat = await createChat(ctx, { userId: 'u1', workspaceIds: [workspaceId], title: 'Who owns orders?' })
      expect(
        await appendChatMessages(ctx, {
          userId: 'u1',
          chatId: chat,
          workspaceIds: [workspaceId],
          messages: [
            { role: 'user', body: { text: 'Who owns orders?' } },
            { role: 'assistant', body: { answers: [{ workspace: 'platform', text: 'Platform engineering [team.platform]' }] } },
          ],
        }),
      ).toBe(true)
      return chat
    })
    const chat = await org.withOrg((ctx) => readChat(ctx, 'u1', id))
    expect(chat).toMatchObject({ id, title: 'Who owns orders?', workspaceIds: [workspaceId] })
    expect(chat?.messages.map((message) => [message.seq, message.role, message.body])).toEqual([
      [1, 'user', { text: 'Who owns orders?' }],
      [2, 'assistant', { answers: [{ workspace: 'platform', text: 'Platform engineering [team.platform]' }] }],
    ])

    // Nothing of the question or the answer is stored as plaintext.
    const raw = await org.withOrg(async ({ tx }) => {
      const chats = await tx.query('SELECT row_to_json(c)::text AS row FROM chats c')
      const messages = await tx.query('SELECT row_to_json(m)::text AS row FROM chat_messages m')
      return [...chats.rows, ...messages.rows].map((row: { row: string }) => row.row).join('\n')
    })
    expect(raw).not.toContain('orders')
    expect(raw).not.toContain('Platform engineering')
  })

  it('shows a chat only to its member, and lists theirs most recently used first', async () => {
    const [older, newer, theirs] = await org.withOrg(async (ctx) => [
      await createChat(ctx, { userId: 'u2', workspaceIds: [workspaceId], title: 'first' }),
      await createChat(ctx, { userId: 'u2', workspaceIds: [workspaceId], title: 'second' }),
      await createChat(ctx, { userId: 'u3', workspaceIds: [workspaceId], title: 'someone else' }),
    ])
    await org.withOrg((ctx) => appendChatMessages(ctx, { userId: 'u2', chatId: older!, workspaceIds: [], messages: [{ role: 'user', body: { text: 'again' } }] }))
    expect((await org.withOrg((ctx) => listChats(ctx, 'u2'))).map((chat) => chat.title)).toEqual(['first', 'second'])
    expect(newer).toBeTruthy()
    expect(await org.withOrg((ctx) => readChat(ctx, 'u2', theirs!))).toBeNull()
    expect(await org.withOrg((ctx) => appendChatMessages(ctx, { userId: 'u2', chatId: theirs!, workspaceIds: [], messages: [{ role: 'user', body: {} }] }))).toBe(false)
    expect(await org.withOrg((ctx) => readChat(ctx, 'u2', 'not-a-uuid'))).toBeNull()
  })

  it('lists a docket’s chats: those asking it alone', async () => {
    const other = await org.withOrg(async (ctx) => (await insertWorkspace(ctx.tx, { name: 'Ledger', slug: 'ledger', createdBy: org.userId })).id)
    await org.withOrg(async (ctx) => {
      await createChat(ctx, { userId: 'u6', workspaceIds: [workspaceId], title: 'just platform' })
      await createChat(ctx, { userId: 'u6', workspaceIds: [workspaceId, other], title: 'both' })
      await createChat(ctx, { userId: 'u6', workspaceIds: [other], title: 'just ledger' })
      await createChat(ctx, { userId: 'u7', workspaceIds: [workspaceId], title: 'someone else' })
    })
    expect((await org.withOrg((ctx) => listChats(ctx, 'u6', { workspaceId }))).map((chat) => chat.title)).toEqual(['just platform'])
    expect((await org.withOrg((ctx) => listChats(ctx, 'u6', { workspaceId: other }))).map((chat) => chat.title)).toEqual(['just ledger'])
    expect(await org.withOrg((ctx) => listChats(ctx, 'u6'))).toHaveLength(3)
  })

  it('deletes a member’s own chat with its messages, never another’s', async () => {
    const [mine, theirs] = await org.withOrg(async (ctx) => {
      const chat = await createChat(ctx, { userId: 'u4', workspaceIds: [workspaceId], title: 'to delete' })
      await appendChatMessages(ctx, { userId: 'u4', chatId: chat, workspaceIds: [workspaceId], messages: [{ role: 'user', body: { text: 'x' } }] })
      return [chat, await createChat(ctx, { userId: 'u5', workspaceIds: [workspaceId], title: 'kept' })]
    })
    expect(await org.withOrg((ctx) => deleteChat(ctx, 'u4', theirs))).toBe(false)
    expect(await org.withOrg((ctx) => deleteChat(ctx, 'u4', mine))).toBe(true)
    expect(await org.withOrg((ctx) => readChat(ctx, 'u4', mine))).toBeNull()
    expect(await org.withOrg(async ({ tx }) => (await tx.query('SELECT 1 FROM chat_messages WHERE chat_id = $1', [mine])).rowCount)).toBe(0)
    expect(await org.withOrg((ctx) => readChat(ctx, 'u5', theirs))).not.toBeNull()
  })

  it('purges a deleted workspace from every chat that asked it, in the deletion', async () => {
    const [payments, data] = await org.withOrg(async (ctx) => [
      await insertWorkspace(ctx.tx, { name: 'Payments', slug: 'payments', createdBy: org.userId }),
      await insertWorkspace(ctx.tx, { name: 'Data', slug: 'data', createdBy: org.userId }),
    ])
    const part = (slug: string, text: string) => ({ workspace: { slug, name: slug }, text, sources: [{ workspace: slug, id: `service.${slug}`, title: `${slug} secret title` }] })
    const asked = (text: string, slugs: string[]) => ({ role: 'user' as const, body: { text, workspaces: slugs.map((slug) => ({ slug, name: slug })) } })
    const answered = (...parts: ReturnType<typeof part>[]) => ({ role: 'assistant' as const, body: { answers: parts } })
    const [mixed, onlyPayments, other] = await org.withOrg(async (ctx) => {
      const mixed = await createChat(ctx, { userId: 'u6', workspaceIds: [payments!.id, data!.id], title: 'mixed' })
      await appendChatMessages(ctx, {
        userId: 'u6',
        chatId: mixed,
        workspaceIds: [payments!.id, data!.id],
        messages: [asked('both?', ['payments', 'data']), answered(part('payments', 'payments says [service.payments]'), part('data', 'data says'))],
      })
      // A later question only Payments answered, though the chat now asks Data alone.
      await appendChatMessages(ctx, { userId: 'u6', chatId: mixed, workspaceIds: [payments!.id], messages: [asked('payments only?', ['payments']), answered(part('payments', 'only payments'))] })
      await appendChatMessages(ctx, { userId: 'u6', chatId: mixed, workspaceIds: [data!.id], messages: [asked('data only?', ['data']), answered(part('data', 'only data'))] })
      const onlyPayments = await createChat(ctx, { userId: 'u6', workspaceIds: [payments!.id], title: 'gone' })
      await appendChatMessages(ctx, { userId: 'u6', chatId: onlyPayments, workspaceIds: [payments!.id], messages: [asked('x', ['payments']), answered(part('payments', 'x'))] })
      const other = await createChat(ctx, { userId: 'u7', workspaceIds: [data!.id], title: 'untouched' })
      await appendChatMessages(ctx, { userId: 'u7', chatId: other, workspaceIds: [data!.id], messages: [asked('y', ['data']), answered(part('data', 'y'))] })
      return [mixed, onlyPayments, other]
    })

    await org.withOrg((ctx) => deleteWorkspace(ctx, { workspaceId: payments!.id, deletedBy: `user:${org.userId}` }))

    const chat = await org.withOrg((ctx) => readChat(ctx, 'u6', mixed))
    expect(chat?.workspaceIds).toEqual([data!.id])
    // The answer only Payments gave went with its question; the mixed answer keeps Data's part and marks Payments'.
    expect(chat?.messages.map((message) => message.seq)).toEqual([1, 2, 5, 6])
    expect(chat?.messages[1]?.body).toEqual({
      answers: [
        { workspace: { slug: 'payments', name: 'payments' }, text: null, model: null, notice: null, error: WORKSPACE_DELETED_MARKER, sources: [], unavailable: [], removed: true },
        part('data', 'data says'),
      ],
    })
    expect(JSON.stringify(chat?.messages)).not.toContain('payments says')
    expect(JSON.stringify(chat?.messages)).not.toContain('payments secret title')
    // A chat with nothing left goes; another member's chat about Data is untouched.
    expect(await org.withOrg((ctx) => readChat(ctx, 'u6', onlyPayments))).toBeNull()
    expect((await org.withOrg((ctx) => readChat(ctx, 'u7', other)))?.messages).toHaveLength(2)
    // A follow-up keeps numbering after the gap.
    await org.withOrg((ctx) => appendChatMessages(ctx, { userId: 'u6', chatId: mixed, workspaceIds: [data!.id], messages: [asked('again', ['data'])] }))
    expect((await org.withOrg((ctx) => readChat(ctx, 'u6', mixed)))?.messages.at(-1)?.seq).toBe(7)
  })

  it("purges a deleted workspace from the Ask agent's answers: the whole answer where it looked there", async () => {
    const [ops, web] = await org.withOrg(async (ctx) => [
      await insertWorkspace(ctx.tx, { name: 'Ops', slug: 'ops', createdBy: org.userId }),
      await insertWorkspace(ctx.tx, { name: 'Web', slug: 'web', createdBy: org.userId }),
    ])
    const asked = (text: string, slugs: string[]) => ({ role: 'user' as const, body: { text, workspaces: slugs.map((slug) => ({ slug, name: slug })) } })
    const agent = (slugs: string[], looked: string[]) => ({
      role: 'assistant' as const,
      body: {
        agent: {
          ui: `root = Answer([p])\np = Prose("${looked.map((slug) => `${slug} secret answer [service.${slug}]`).join(' ')}")`,
          model: 'm',
          notice: null,
          error: null,
          steps: looked.map((slug) => ({ tool: 'docket_search', workspace: slug, input: `${slug} secret query`, result: '1 record', state: 'done', ms: 5 })),
          sources: looked.map((slug) => ({ workspace: slug, id: `service.${slug}`, title: `${slug} secret title`, type: 'service', cited: true, stale: false, foundBy: [] })),
          workspaces: slugs.map((slug) => ({ slug, name: slug })),
          costUsd: 0.01,
        },
        tookMs: 900,
      },
    })
    const chatId = await org.withOrg(async (ctx) => {
      const id = await createChat(ctx, { userId: 'u8', workspaceIds: [ops!.id, web!.id], title: 'agent' })
      await appendChatMessages(ctx, {
        userId: 'u8',
        chatId: id,
        workspaceIds: [ops!.id, web!.id],
        messages: [asked('both, looked in both?', ['ops', 'web']), agent(['ops', 'web'], ['ops', 'web'])],
      })
      await appendChatMessages(ctx, { userId: 'u8', chatId: id, workspaceIds: [ops!.id, web!.id], messages: [asked('both, looked in web?', ['ops', 'web']), agent(['ops', 'web'], ['web'])] })
      await appendChatMessages(ctx, { userId: 'u8', chatId: id, workspaceIds: [ops!.id], messages: [asked('ops only?', ['ops']), agent(['ops'], ['ops'])] })
      return id
    })

    await org.withOrg((ctx) => deleteWorkspace(ctx, { workspaceId: ops!.id, deletedBy: `user:${org.userId}` }))

    const chat = await org.withOrg((ctx) => readChat<{ agent?: Record<string, unknown> }>(ctx, 'u8', chatId))
    // The answer only Ops was asked went with its question.
    expect(chat?.messages.map((message) => message.seq)).toEqual([1, 2, 3, 4])
    // It looked in Ops: the answer is the marker, keeping Web's steps and records.
    expect(chat?.messages[1]?.body.agent).toMatchObject({
      ui: null,
      error: WORKSPACE_DELETED_MARKER,
      removed: true,
      workspaces: [{ slug: 'web', name: 'web' }],
      steps: [{ workspace: 'web' }],
      sources: [{ workspace: 'web', id: 'service.web' }],
    })
    // It never looked in Ops: the answer stands, asked of Web alone.
    expect(chat?.messages[3]?.body.agent).toMatchObject({ error: null, workspaces: [{ slug: 'web', name: 'web' }] })
    expect(chat?.messages[3]?.body.agent?.ui).toContain('web secret answer')
    expect(JSON.stringify(chat?.messages.filter((message) => message.role === 'assistant'))).not.toMatch(/ops secret/)
  })
})
