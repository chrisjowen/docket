// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type { Chat } from '@chrisjowen/docket/adapter-kit'
import type { AdapterAnswer } from '@chrisjowen/docket/contracts'
import { workspaceScope } from '@docket/platform-tenancy'

import { closeAll, openProjections, type StoreAccess } from './adapters.js'

/**
 * `docket_ask` over a workspace's Neo4j: the org's Cypher model writes a
 * read-only query from the question (§6.3). Unlike search, this spends the
 * org's AI budget, so the model is the caller's metered, capped one.
 *
 * The Neo4j adapter falls back to full-text search when its model fails;
 * here a model that failed or refused (the cap reached) is the caller's to
 * see, so its error is thrown rather than hidden behind a full-text answer.
 */
export async function askWorkspace(options: {
  orgId: string
  workspaceId: string
  access: StoreAccess
  question: string
  cypher: Chat
  maxResults?: number
  timeoutMs?: number
}): Promise<AdapterAnswer> {
  let refused: { error: unknown } | undefined
  const cypher: Chat = async (prompt, chatOptions) => {
    try {
      return await options.cypher(prompt, chatOptions)
    } catch (error) {
      refused ??= { error }
      throw error
    }
  }
  const adapters = await openProjections({ orgId: options.orgId, workspaceId: options.workspaceId, access: options.access, cypher, only: ['neo4j'] })
  try {
    const query = adapters.neo4j?.query
    if (!query) throw new Error('neo4j does not answer queries')
    const answer = await query.ask({
      requestId: randomUUID(),
      question: options.question,
      context: { scope: workspaceScope(options.workspaceId), now: new Date().toISOString(), timezone: 'UTC' },
      budget: {
        maxResults: options.maxResults ?? 10,
        maxEvidenceBytes: 64 * 1024,
        deadline: new Date(Date.now() + (options.timeoutMs ?? 30_000)).toISOString(),
      },
    })
    if (refused) throw refused.error
    return answer
  } finally {
    await closeAll(adapters)
  }
}
