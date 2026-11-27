// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import type { AdapterAnswer } from '@chrisjowen/docket/contracts'
import { workspaceScope } from '@docket/platform-tenancy'

import { closeAll, openProjections, type CloudProjection, type StoreAccess } from './adapters.js'

export interface SearchOutcome {
  instance: CloudProjection
  answer?: AdapterAnswer
  /** Why the instance did not answer; the others still do (adapter-spec §10). */
  error?: string
}

/**
 * `docket_search` over a workspace's projections: Neo4j full-text and mem0's
 * semantic recall. It needs no model (§11), so it never touches the AI cap
 * and keeps working when an org's budget is spent; the Neo4j adapter is
 * opened without its Cypher model, so it answers with full-text search.
 */
export async function searchWorkspace(options: {
  orgId: string
  workspaceId: string
  access: StoreAccess
  question: string
  maxResults?: number
  timeoutMs?: number
}): Promise<SearchOutcome[]> {
  const instances: CloudProjection[] = ['neo4j', 'mem0']
  return Promise.all(
    instances.map(async (instance): Promise<SearchOutcome> => {
      let adapters: Awaited<ReturnType<typeof openProjections>> = {}
      try {
        adapters = await openProjections({ orgId: options.orgId, workspaceId: options.workspaceId, access: options.access, only: [instance] })
        const query = adapters[instance]?.query
        if (!query) return { instance, error: 'does not answer queries' }
        const answer = await query.ask({
          requestId: randomUUID(),
          question: options.question,
          context: { scope: workspaceScope(options.workspaceId), now: new Date().toISOString(), timezone: 'UTC' },
          budget: {
            maxResults: options.maxResults ?? 10,
            maxEvidenceBytes: 64 * 1024,
            deadline: new Date(Date.now() + (options.timeoutMs ?? 15_000)).toISOString(),
          },
        })
        return { instance, answer }
      } catch (error) {
        return { instance, error: error instanceof Error ? error.message : String(error) }
      } finally {
        await closeAll(adapters)
      }
    }),
  )
}
