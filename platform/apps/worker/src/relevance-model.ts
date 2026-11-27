// SPDX-License-Identifier: AGPL-3.0-only
import type { CutModel } from './relevance.js'

/*
 * The cut models `docket_search` runs (`relevance.ts`), as the search
 * relevance evaluation fitted them (`search-relevance.int.test.ts`, its
 * `models.json`): over docket's search evaluation corpora projected into the
 * cloud's own Neo4j full-text index and mem0 with nomic-embed-text, whose
 * scores sit on scales of their own, so they are refitted whenever a
 * projector, its embedder or the re-ranker changes. On its test questions,
 * macro over six corpora, against the search they replace (nDCG@10 0.618,
 * no-answer FPR 1.00, reply precision 0.29, 8.6 results): re-ranked 0.622,
 * 0.31, 0.62 and 3.0 results; on the projections' scores alone 0.645, 0.41,
 * 0.52 and 4.3 results.
 */

/** The features the re-ranked cut reads: the cross-encoder's score and the projections'. */
export const RERANKED_FEATURES = [
  'logit',
  'probability',
  'logitGap',
  'topProbability',
  'rerankRank',
  'cosine',
  'cosineGap',
  'topCosine',
  'semanticRank',
  'coverage',
  'lexicalShare',
  'lexicalRank',
  'both',
  'semanticOnly',
  'lexicalOnly',
] as const

/** The features the fallback cut reads: the projections' scores alone. */
export const RETRIEVAL_FEATURES = RERANKED_FEATURES.filter((name) => !['logit', 'probability', 'logitGap', 'topProbability', 'rerankRank'].includes(name))

/** The cut over the re-ranker's scores, fitted 2026-11-13. */
export const CUT_MODEL: CutModel = {
  name: 'ms-marco-MiniLM-L6-v2 over Neo4j full-text and mem0 nomic-embed-text, 2026-11-13',
  reranker: 'cross-encoder/ms-marco-MiniLM-L6-v2@int8-vnni',
  features: RERANKED_FEATURES,
  mean: [-3.32566, 0.322457, -7.31555, 0.813346, 0.63803, 0.456439, -0.243786, 0.777763, 1.09543, 0.306542, 0.406955, 1.37227, 0.376373, 0.370207, 0.25342],
  scale: [5.99478, 0.416019, 5.69682, 0.334005, 0.422463, 0.335914, 0.219272, 0.152513, 1.13711, 0.271006, 0.377375, 1.26869, 0.484475, 0.48286, 0.434969],
  weights: [0.643609, 0.130719, 1.1935, 0.068415, -0.0418467, -0.386655, -0.0314209, -0.410247, -0.607048, 0.752572, 0.225061, -0.00978592, -0.103781, 0.0858872, 0.0202494],
  bias: -2.70529,
  answer: 0.3,
  threshold: 0.2,
  ratio: 0.6,
}

/** The cut when the re-ranker does not answer: the projections' scores alone, fitted 2026-11-13. */
export const RETRIEVAL_CUT_MODEL: CutModel = {
  name: 'Neo4j full-text and mem0 nomic-embed-text scores alone, 2026-11-13',
  reranker: null,
  features: RETRIEVAL_FEATURES,
  mean: [0.456439, -0.243786, 0.777763, 1.09543, 0.306542, 0.406955, 1.37227, 0.376373, 0.370207, 0.25342],
  scale: [0.335914, 0.219272, 0.152513, 1.13711, 0.271006, 0.377375, 1.26869, 0.484475, 0.48286, 0.434969],
  weights: [-0.184879, 0.534126, -0.332227, -0.891947, 1.17813, 0.588637, -0.0874187, -0.433024, 0.148854, 0.317066],
  bias: -2.08695,
  answer: 0.15,
  threshold: 0.1,
  ratio: 0.4,
}
