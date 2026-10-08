import type { AdapterAnswer, Diagnostic } from '@docket/contracts'

import type { UiAnswer, UiChatAnswer, UiDiagnostic, UiIndexStatus } from '$lib/types.js'
import type { AdapterResult, CoordinatedAnswer } from './wire.js'

/*
 * The legacy `GET /api/ask` and `GET /api/chat` answers as coordinated
 * answers (docs/adapter-spec.md §15 step 5: existing hits become entity
 * blocks), so the Ask workspace works the same before `POST /api/ask` exists.
 */

/** Hits asked of each source; a source returning this many may have had more. */
export const LEGACY_LIMIT = 10

/** The scope v1 configuration answers in. */
export const LEGACY_SCOPE = 'default'

const diagnostic = (item: UiDiagnostic): Diagnostic => ({ severity: item.severity, code: item.code, message: item.message })

const indexDiagnostic = (index: UiIndexStatus): Diagnostic[] => {
  if (!index.synced) {
    return [{ severity: 'warning', code: 'index-not-synced', message: 'The search index has not been synced, so search may find nothing. Run `docket sync`.' }]
  }
  if (index.behind > 0) {
    const files = index.behind === 1 ? '1 file has' : `${index.behind} files have`
    return [{ severity: 'warning', code: 'index-behind', message: `${files} changed since the last sync; search may miss them. Run \`docket sync\`.` }]
  }
  return []
}

const sourceResult = (source: UiAnswer['sources'][number]): AdapterResult => {
  if (source.error !== undefined) {
    return { adapter: source.name, state: 'failed', error: { code: 'unavailable', message: source.error } }
  }
  const answer: AdapterAnswer = {
    interpretation: { description: source.note ?? '', assumptions: [] },
    blocks:
      source.hits.length === 0
        ? []
        : [
            {
              kind: 'entities',
              id: `${source.name}:hits`,
              title: 'Exhibits found',
              evidenceIds: [],
              entities: source.hits.map((hit) => ({
                ref: { kind: 'entity', id: hit.id },
                ...(hit.score === undefined ? {} : { score: hit.score }),
                ...(hit.detail === undefined ? {} : { detail: hit.detail })
              }))
            }
          ],
    evidence: [],
    coverage: { mode: 'top-k', truncated: source.hits.length >= LEGACY_LIMIT, scope: LEGACY_SCOPE },
    diagnostics: []
  }
  return { adapter: source.name, state: 'answered', answer }
}

/** A `GET /api/ask` answer: one entity block per source that found anything, failures kept per source. */
export const fromLegacyAnswer = (answer: UiAnswer, requestId: string): CoordinatedAnswer => ({
  requestId,
  question: answer.query,
  results: answer.sources.map(sourceResult),
  synthesis: null,
  connections: answer.paths,
  diagnostics: [...indexDiagnostic(answer.index), ...answer.diagnostics.map(diagnostic)]
})

/** A `GET /api/chat` reply: the answer it summarised, and its summary as the synthesis. */
export const fromLegacyChat = (reply: UiChatAnswer, requestId: string): CoordinatedAnswer => ({
  ...fromLegacyAnswer(reply.answer, requestId),
  question: reply.query,
  synthesis: reply.summary
    ? {
        text: reply.summary.text,
        citedEvidence: [],
        citedEntities: reply.summary.cited,
        model: reply.summary.model,
        cached: reply.summary.cached,
        createdAt: reply.summary.createdAt
      }
    : null,
  ...(reply.notice ? { notice: reply.notice } : {})
})
