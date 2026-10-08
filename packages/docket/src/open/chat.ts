import { askProject } from '../query/ask.js'
import { toLegacyChat } from '../query/legacy.js'
import { indexStatus } from './graph.js'
import type { UiChatAnswer } from './types.js'

export { citationsIn } from '../query/synthesis.js'

/**
 * The legacy `GET /api/chat` reply, translated from the coordinator's answer
 * with synthesis on: the legacy answer, and the model's summary of it citing
 * the exhibits. Summaries are cached in `.docket/.cache/chat/` - the one thing
 * this writes.
 */
export const chat = async (cwd: string, query: string, limit: number): Promise<UiChatAnswer> => {
  const outcome = await askProject(cwd, { question: query, maxResults: limit, synthesis: true })
  const { resolved, entities, documents, broken } = outcome.snapshot
  return toLegacyChat(outcome, await indexStatus(resolved, entities, documents, broken))
}
