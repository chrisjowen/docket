/*
 * The re-ranker's client. The model itself (an ONNX cross-encoder) runs in a
 * process of its own beside the stores, as an embedder does; the search
 * pipeline asks it over HTTP(S).
 */

/**
 * The cross-encoder `docket_search` re-ranks its candidates with: it reads
 * the question and each record together and scores how well the record
 * answers it, which neither projection does (each scores the question and the
 * record apart). It runs on the CPU in a process of its own, as an
 * embedder does, and the search pipeline asks it over HTTP(S).
 */
export interface Reranker {
  /** The model, as the cut model it is used with names it. */
  readonly model: string
  /** One logit per text, in order: higher is more relevant to `query`. */
  score(query: string, texts: readonly string[]): Promise<number[]>
}

/** A cross-encoder on Hugging Face: its files at a pinned revision, and the ONNX file's sha256. */
export interface RerankerModel {
  name: string
  repo: string
  revision: string
  onnx: string
  sha256: string
}

/**
 * The model in use: ms-marco-MiniLM-L6-v2 (22M parameters, Apache-2.0),
 * int8-quantised for AVX-512 VNNI, which the node's CPU has. It reads 256
 * tokens of question and record together.
 */
export const RERANKER_MODEL: RerankerModel = {
  name: 'cross-encoder/ms-marco-MiniLM-L6-v2@int8-vnni',
  repo: 'cross-encoder/ms-marco-MiniLM-L6-v2',
  revision: '233902d25c440f23af6f7d6e94d2946bac0bee0a',
  onnx: 'onnx/model_qint8_avx512_vnni.onnx',
  sha256: '3573b6b9593cb2f75987a31815d409ca3dd8808629118fd20451bb1a5d90cec7'
}

export const RERANK_PATH = '/rerank'
/** The most texts the re-ranker reads for one question. */
export const MAX_TEXTS = 64

/** The search pipeline's side: the re-ranker's process over HTTP(S), `POST /rerank` with `{ query, texts }` answered `{ model, logits }`. */
export function rerankerClient(options: { url: string; model: string; timeoutMs?: number; fetch?: typeof fetch }): Reranker {
  const doFetch = options.fetch ?? fetch
  return {
    model: options.model,
    async score(query, texts) {
      if (texts.length === 0) return []
      const response = await doFetch(new URL(RERANK_PATH, options.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, texts }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000)
      })
      if (!response.ok) throw new Error(`the re-ranker answered ${response.status}`)
      const body = (await response.json()) as { model?: unknown; logits?: unknown }
      if (body.model !== options.model) throw new Error(`the re-ranker runs ${String(body.model)}, not ${options.model}`)
      if (!Array.isArray(body.logits) || body.logits.length !== texts.length || !body.logits.every((logit) => typeof logit === 'number')) {
        throw new Error('the re-ranker answered without a score for each text')
      }
      return body.logits as number[]
    }
  }
}

