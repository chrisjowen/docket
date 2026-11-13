import { createHash, randomUUID } from 'node:crypto'

/*
 * An in-memory cognee REST API behind a `fetch`, for the adapter's tests. It
 * answers the endpoints the adapter calls as cognee 1.6.8 does - checked
 * against a running server, see the README - including what matters to the
 * adapter: one data item per content hash (the first one's metadata kept),
 * chunks searchable only once cognified, each chunk carrying its item's
 * metadata as a JSON string, a cosine *distance* as its score, and results
 * wrapped per dataset unless access control is off. Search scores are a
 * word-overlap stand-in for embeddings.
 */

export interface FakeItem {
  id: string
  name: string
  text: string
  externalMetadata: Record<string, unknown> | null
  contentHash: string
  cognified: boolean
}

export interface FakeDataset {
  id: string
  name: string
  items: Map<string, FakeItem>
}

export interface FakeCogneeOptions {
  version?: string
  /** Requests without this `X-Api-Key` are refused with 401. */
  apiKey?: string
  /**
   * ENABLE_BACKEND_ACCESS_CONTROL, cognee's default: on, a search answers per
   * dataset (`{ dataset_id, search_result }`); off, it answers with a bare
   * list - and reaches every dataset's chunks, whichever it was asked for.
   */
  accessControl?: boolean
}

export interface FakeCognee {
  fetch: typeof fetch
  datasets: Map<string, FakeDataset>
  /** Every request, as `METHOD /path`. */
  requests: string[]
  /** The answer a completion search gives; `null` fails the search. */
  completion: string | null
  /** Makes the next cognify fail, as a model error would. */
  failNextCognify: boolean
  /** Makes every request fail to connect. */
  down: boolean
  /** Adds an item as another writer would, outside docket. */
  addForeign(datasetName: string, text: string, metadata?: Record<string, unknown> | null): FakeItem
}

const md5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex')

const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2))

/** 1 - the share of the query's words the text holds: 0 is a perfect match, 1 shares nothing. */
const distance = (query: string, text: string): number => {
  const asked = words(query)
  if (asked.size === 0) return 1
  const held = words(text)
  let shared = 0
  for (const word of asked) if (held.has(word)) shared += 1
  return Math.round((1 - shared / asked.size) * 1000) / 1000
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A deterministic dataset id, as cognee derives one from the name and owner. */
const datasetId = (name: string): string => {
  const hex = createHash('sha256').update(`dataset:${name}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const chunkId = (dataId: string): string => `c${dataId.slice(1)}`

export const startFakeCognee = (options: FakeCogneeOptions = {}): FakeCognee => {
  const datasets = new Map<string, FakeDataset>()
  const requests: string[] = []
  const byId = (id: string): FakeDataset | undefined => [...datasets.values()].find((dataset) => dataset.id === id)
  const ensure = (name: string): FakeDataset => {
    let dataset = datasets.get(name)
    if (!dataset) {
      dataset = { id: datasetId(name), name, items: new Map() }
      datasets.set(name, dataset)
    }
    return dataset
  }
  const add = (dataset: FakeDataset, name: string, text: string, metadata: Record<string, unknown> | null): FakeItem => {
    const hash = md5(text)
    const existing = [...dataset.items.values()].find((item) => item.contentHash === hash)
    if (existing) return existing
    const item: FakeItem = { id: randomUUID(), name, text, externalMetadata: metadata, contentHash: hash, cognified: false }
    dataset.items.set(item.id, item)
    return item
  }

  const fake: FakeCognee = {
    datasets,
    requests,
    completion: null,
    failNextCognify: false,
    down: false,
    addForeign: (name, text, metadata = null) => add(ensure(name), 'foreign.txt', text, metadata),
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const method = init?.method ?? 'GET'
      requests.push(`${method} ${url.pathname}`)
      if (fake.down) throw new TypeError('fetch failed')
      if (url.pathname === '/health') return json(200, { status: 'ready', health: 'healthy', version: options.version ?? '1.6.8-local' })
      const headers = new Headers(init?.headers)
      if (options.apiKey !== undefined && headers.get('x-api-key') !== options.apiKey) return json(401, { detail: 'Unauthorized' })

      const path = url.pathname.replace(/^\/api\/v1/, '')
      if (method === 'GET' && path === '/datasets') {
        return json(200, [...datasets.values()].map((dataset) => ({ id: dataset.id, name: dataset.name, ownerId: 'owner' })))
      }
      const data = /^\/datasets\/([^/]+)\/data(?:\/(count|[^/]+))?$/.exec(path)
      if (data) {
        const dataset = byId(decodeURIComponent(data[1] as string))
        if (!dataset) return json(403, { detail: 'Request owner does not have necessary permission: [read] for all datasets requested. [PermissionDeniedError]' })
        if (method === 'GET' && data[2] === 'count') return json(200, { count: dataset.items.size })
        if (method === 'GET' && data[2] === undefined) {
          const hash = url.searchParams.get('content_hash')
          const limit = Number(url.searchParams.get('limit') ?? 100)
          const offset = Number(url.searchParams.get('offset') ?? 0)
          const items = [...dataset.items.values()].filter((item) => hash === null || item.contentHash === hash)
          return json(
            200,
            items.slice(offset, offset + limit).map((item) => ({
              id: item.id,
              name: item.name,
              datasetId: dataset.id,
              externalMetadata: item.externalMetadata,
              contentHash: item.contentHash
            }))
          )
        }
        if (method === 'DELETE' && data[2] !== undefined) {
          const found = dataset.items.delete(data[2])
          return json(200, { status: found ? 'success' : 'not_found', datasetId: dataset.id, dataId: data[2], dataRecordFound: found })
        }
      }
      if (method === 'POST' && path === '/add') {
        const form = init?.body as FormData
        const file = form.get('data') as File
        const metadata = JSON.parse(String(form.get('external_metadata') ?? '[null]')) as (Record<string, unknown> | null)[]
        const named = form.get('datasetName')
        const dataset = named !== null ? ensure(String(named)) : byId(String(form.get('datasetId')))
        if (!dataset) return json(403, { detail: 'no such dataset' })
        const item = add(dataset, file.name.replace(/\.[^.]+$/, ''), await file.text(), metadata[0] ?? null)
        return json(200, { status: 'PipelineRunCompleted', dataset_id: dataset.id, dataset_name: dataset.name, data_ids: [item.id] })
      }
      if (method === 'POST' && path === '/cognify') {
        const body = JSON.parse(String(init?.body)) as { dataset_ids: string[] }
        const answer: Record<string, unknown> = {}
        for (const id of body.dataset_ids) {
          const dataset = byId(id)
          if (!dataset) return json(403, { detail: 'no such dataset' })
          if (fake.failNextCognify) {
            fake.failNextCognify = false
            answer[id] = { status: 'PipelineRunErrored', dataset_id: id, payload: 'LLM extraction failed' }
            continue
          }
          for (const item of dataset.items.values()) item.cognified = true
          answer[id] = { status: 'PipelineRunCompleted', dataset_id: id }
        }
        return json(200, answer)
      }
      if (method === 'POST' && path === '/search') {
        const body = JSON.parse(String(init?.body)) as { search_type: string; dataset_ids: string[]; query: string; top_k: number }
        const scoped = body.dataset_ids.map(byId)
        if (scoped.some((dataset) => dataset === undefined)) return json(403, { detail: 'no such dataset' })
        const accessControl = options.accessControl ?? true
        const searched = accessControl ? (scoped as FakeDataset[]) : [...datasets.values()]
        const wrap = (results: unknown[]): unknown[] =>
          accessControl ? (scoped as FakeDataset[]).map((dataset) => ({ dataset_id: dataset.id, dataset_name: dataset.name, dataset_tenant_id: null, search_result: results })) : results
        const chunks = searched
          .flatMap((dataset) => [...dataset.items.values()])
          .filter((item) => item.cognified)
          .map((item) => ({ item, score: distance(body.query, item.text) }))
          .filter(({ score }) => score < 1)
          .sort((a, b) => a.score - b.score || (a.item.id < b.item.id ? -1 : 1))
          .slice(0, body.top_k)
        if (body.search_type === 'CHUNKS') {
          return json(
            200,
            wrap(chunks.map(({ item, score }) => ({
              id: chunkId(item.id),
              type: 'IndexSchema',
              text: item.text,
              document_id: item.id,
              document_name: item.name,
              chunk_index: 0,
              external_metadata: item.externalMetadata === null ? null : JSON.stringify(item.externalMetadata),
              score
            })))
          )
        }
        if (fake.completion === null) return json(500, { detail: 'LLM unavailable' })
        const evidence = chunks.map(({ item }, at) => `- chunk ${at + 1} of document ${item.name} (data_id: ${item.id}, chunk_id: ${chunkId(item.id)})`)
        return json(200, wrap([evidence.length > 0 ? `${fake.completion}\n\nEvidence:\n${evidence.join('\n')}` : fake.completion]))
      }
      return json(404, { detail: 'Not Found' })
    }
  }
  return fake
}
