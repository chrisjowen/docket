// SPDX-License-Identifier: AGPL-3.0-only
import { localReranker, startRerankerServer } from './reranker.js'

/**
 * The re-ranker pod (`deploy/helm/docket-cloud/templates/reranker.yaml`): the
 * cross-encoder `docket_search` re-ranks with, downloaded once onto the pod's
 * volume and checked against its pinned hash, served to the worker over
 * HTTPS. It holds no credential and reads no store: it sees a question and
 * the candidate records' text, and answers with a score for each.
 */

const env = process.env
const log = {
  info: (message: string) => console.log(`${new Date().toISOString()} ${message}`),
  error: (message: string) => console.error(`${new Date().toISOString()} ${message}`),
}

const tls = env.DOCKET_RERANKER_TLS_CERT && env.DOCKET_RERANKER_TLS_KEY ? { certFile: env.DOCKET_RERANKER_TLS_CERT, keyFile: env.DOCKET_RERANKER_TLS_KEY } : null
const server = startRerankerServer({
  reranker: localReranker({ cacheDir: env.DOCKET_RERANKER_MODELS ?? '/models', threads: Number(env.DOCKET_RERANKER_THREADS ?? 2) }),
  port: Number(env.DOCKET_RERANKER_PORT ?? 8444),
  host: env.DOCKET_RERANKER_HOST ?? (tls ? '0.0.0.0' : '127.0.0.1'),
  tls,
  production: env.NODE_ENV === 'production',
  log,
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log.info(`${signal}: closing`)
    server.close(() => process.exit(0))
  })
}
