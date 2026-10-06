import { validate } from '../commands/validate.js'
import { search } from '../commands/search.js'
import { indexStatus } from './graph.js'
import { connectingPaths } from './paths.js'
import type { UiAnswer } from './types.js'

/**
 * Answers a question the way `docket search` does - every searchable
 * projection, each in its own terms - and adds the relationship paths that
 * join what was found, read from the canonical files.
 */
export const ask = async (cwd: string, query: string, limit: number): Promise<UiAnswer> => {
  const [answer, { resolved, entities, broken }] = await Promise.all([
    search(query, { cwd, limit }),
    validate({ cwd })
  ])

  const edges = entities.flatMap((entity) =>
    entity.links.map((link) => ({ source: entity.id, rel: link.rel, target: link.target }))
  )

  // Most relevant first: the order the first answering source ranked them in.
  const ranked = [
    ...new Set([
      ...answer.sources.flatMap((source) => source.hits.map((hit) => hit.id)),
      ...answer.documents.map((document) => document.id)
    ])
  ]

  return {
    query: answer.query,
    sources: answer.sources,
    documents: answer.documents,
    paths: connectingPaths(edges, ranked),
    diagnostics: answer.diagnostics,
    index: await indexStatus(resolved, entities, broken)
  }
}
