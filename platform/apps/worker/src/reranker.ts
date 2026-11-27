// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { dirname, join } from 'node:path'

import type { Logger } from './outbox.js'

/**
 * The cross-encoder `docket_search` re-ranks its candidates with: it reads
 * the question and each record together and scores how well the record
 * answers it, which neither projection does (each scores the question and the
 * record apart). It runs on the node's CPU in a pod of its own, as the
 * embedder does (`deploy/helm/docket-cloud/templates/reranker.yaml`), and the
 * worker asks it over HTTPS; the search evaluation runs the same model in
 * process (`search-relevance.int.test.ts`).
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
  sha256: '3573b6b9593cb2f75987a31815d409ca3dd8808629118fd20451bb1a5d90cec7',
}

/** Tokens of question and record read together. */
export const MAX_TOKENS = 256
/** Pairs scored in one run of the model; shorter texts are batched together, so padding stays small. */
const BATCH = 16

async function fetchPinned(model: RerankerModel, file: string, cacheDir: string, fetchFn: typeof fetch): Promise<string> {
  const path = join(cacheDir, model.repo, model.revision, file)
  if (existsSync(path)) return path
  const response = await fetchFn(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${file}`, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok) throw new Error(`downloading ${model.repo}/${file}: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (file === model.onnx) {
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== model.sha256) throw new Error(`${model.repo}/${file} has sha256 ${digest}, not the pinned ${model.sha256}`)
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.part`, bytes)
  await rename(`${path}.part`, path)
  return path
}

interface Encoded {
  ids: number[]
  types: number[]
}

/**
 * The model in this process: its files downloaded once into `cacheDir` (the
 * pod's volume), checked against the pinned hash, and run on the CPU through
 * ONNX Runtime with `threads` threads.
 */
export async function localReranker(options: { model?: RerankerModel; cacheDir: string; threads?: number; fetch?: typeof fetch }): Promise<Reranker> {
  const model = options.model ?? RERANKER_MODEL
  const fetchFn = options.fetch ?? fetch
  const [onnxPath, tokenizerPath, configPath] = await Promise.all(
    [model.onnx, 'tokenizer.json', 'tokenizer_config.json'].map((file) => fetchPinned(model, file, options.cacheDir, fetchFn)),
  )
  const [{ InferenceSession, Tensor }, { Tokenizer }] = await Promise.all([import('onnxruntime-node'), import('@huggingface/tokenizers')])
  const tokenizer = new Tokenizer(JSON.parse(await readFile(tokenizerPath as string, 'utf8')), JSON.parse(await readFile(configPath as string, 'utf8')))
  const session = await InferenceSession.create(onnxPath as string, {
    intraOpNumThreads: options.threads ?? 2,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
  })
  const padId = tokenizer.token_to_id('[PAD]') ?? tokenizer.token_to_id('<pad>') ?? 0
  const bare = (text: string) => tokenizer.encode(text, { add_special_tokens: false }).ids

  /** The question and as much of the record as fits in `MAX_TOKENS`, with the model's special tokens. */
  const encode = (query: string, text: string): Encoded => {
    const question = bare(query).slice(0, MAX_TOKENS / 2)
    const room = MAX_TOKENS - question.length - 4
    const record = bare(text)
    const fitted = record.length > room ? tokenizer.decode(record.slice(0, room)) : text
    const pair = tokenizer.encode(tokenizer.decode(question), { text_pair: fitted, return_token_type_ids: true })
    return { ids: pair.ids.slice(0, MAX_TOKENS), types: pair.token_type_ids.slice(0, MAX_TOKENS) }
  }

  const run = async (batch: readonly Encoded[]): Promise<number[]> => {
    const width = Math.max(...batch.map((item) => item.ids.length))
    const tensor = (fill: (item: Encoded, at: number) => number) => {
      const data = new BigInt64Array(batch.length * width)
      batch.forEach((item, row) => {
        for (let at = 0; at < width; at += 1) data[row * width + at] = BigInt(fill(item, at))
      })
      return new Tensor('int64', data, [batch.length, width])
    }
    const feeds: Record<string, InstanceType<typeof Tensor>> = {
      input_ids: tensor((item, at) => item.ids[at] ?? padId),
      attention_mask: tensor((item, at) => (at < item.ids.length ? 1 : 0)),
    }
    if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = tensor((item, at) => item.types[at] ?? 0)
    const output = await session.run(feeds)
    const logits = output.logits ?? output[session.outputNames[0] as string]
    return Array.from(logits?.data as Float32Array, Number)
  }

  return {
    model: model.name,
    async score(query, texts) {
      const encoded = texts.map((text, index) => ({ index, ...encode(query, text) })).sort((a, b) => a.ids.length - b.ids.length)
      const logits = new Array<number>(texts.length)
      for (let start = 0; start < encoded.length; start += BATCH) {
        const batch = encoded.slice(start, start + BATCH)
        const scores = await run(batch)
        batch.forEach((item, at) => (logits[item.index] = scores[at] as number))
      }
      return logits
    },
  }
}

export const RERANK_PATH = '/rerank'
/** The most texts the re-ranker reads for one question. */
export const MAX_TEXTS = 64
const MAX_BODY_BYTES = 512 * 1024

/** The worker's side: the re-ranker pod over HTTPS, which the network policy admits only the worker to. */
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
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      })
      if (!response.ok) throw new Error(`the re-ranker answered ${response.status}`)
      const body = (await response.json()) as { model?: unknown; logits?: unknown }
      if (body.model !== options.model) throw new Error(`the re-ranker runs ${String(body.model)}, not ${options.model}`)
      if (!Array.isArray(body.logits) || body.logits.length !== texts.length || !body.logits.every((logit) => typeof logit === 'number')) {
        throw new Error('the re-ranker answered without a score for each text')
      }
      return body.logits as number[]
    },
  }
}

async function readBody(req: IncomingMessage): Promise<{ query: string; texts: string[] } | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk as Buffer)
  }
  try {
    const { query, texts } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: unknown; texts?: unknown }
    if (typeof query !== 'string' || !Array.isArray(texts) || texts.length > MAX_TEXTS || !texts.every((text) => typeof text === 'string')) return null
    return { query, texts: texts as string[] }
  } catch {
    return null
  }
}

/**
 * Serves `reranker` on `POST /rerank` ({ query, texts } to { model, logits }),
 * with `/healthz` and `/readyz` for the kubelet: HTTPS with the internal CA's
 * certificate in the cluster; plain HTTP on loopback only, outside production.
 */
export function startRerankerServer(options: {
  reranker: Promise<Reranker>
  port: number
  host: string
  tls: { certFile: string; keyFile: string } | null
  production: boolean
  log: Logger
}): Server {
  if (!options.tls && (options.production || !['127.0.0.1', '::1', 'localhost'].includes(options.host))) {
    throw new Error('the re-ranker needs DOCKET_RERANKER_TLS_CERT and DOCKET_RERANKER_TLS_KEY outside a loopback preview')
  }
  let ready: Reranker | null = null
  let failed: string | null = null
  options.reranker.then(
    (reranker) => {
      ready = reranker
      options.log.info(`re-ranker: ${reranker.model} loaded`)
    },
    (cause: unknown) => {
      failed = cause instanceof Error ? cause.message : String(cause)
      options.log.error(`re-ranker: loading the model: ${failed}`)
    },
  )
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    if (req.method === 'GET' && req.url === '/healthz') return reply(failed ? 500 : 200, failed ? { error: failed } : { ok: true })
    if (req.method === 'GET' && req.url === '/readyz') return reply(ready ? 200 : 503, { ready: Boolean(ready) })
    if (req.method !== 'POST' || req.url !== RERANK_PATH) return reply(404, { error: 'Not found.' })
    if (!ready) return reply(503, { error: 'The re-ranker is still loading its model.' })
    const body = await readBody(req)
    if (!body) return reply(400, { error: `Send { "query": "...", "texts": [...] }, at most ${MAX_TEXTS} texts.` })
    try {
      const reranker: Reranker = ready
      return reply(200, { model: reranker.model, logits: await reranker.score(body.query, body.texts) })
    } catch (cause) {
      options.log.error(`re-ranker: ${cause instanceof Error ? cause.message : String(cause)}`)
      return reply(500, { error: 'The re-ranker failed.' })
    }
  }
  const listener = (req: IncomingMessage, res: ServerResponse) => void handle(req, res)
  const tls = options.tls
  const credentials = () => (tls ? { cert: readFileSync(tls.certFile), key: readFileSync(tls.keyFile) } : null)
  const first = credentials()
  const server = first ? createHttpsServer({ ...first, minVersion: 'TLSv1.2' }, listener) : createHttpServer(listener)
  if (first && 'setSecureContext' in server) {
    // cert-manager renews the certificate in place: pick the new one up within the hour.
    const https = server
    const timer = setInterval(() => {
      try {
        https.setSecureContext({ ...(credentials() ?? {}), minVersion: 'TLSv1.2' })
      } catch (cause) {
        options.log.error(`re-ranker: reloading its certificate: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }, 60 * 60_000)
    timer.unref()
    server.on('close', () => clearInterval(timer))
  }
  server.listen(options.port, options.host)
  options.log.info(`re-ranker on ${tls ? 'https' : 'http'}://${options.host}:${options.port}`)
  return server
}
