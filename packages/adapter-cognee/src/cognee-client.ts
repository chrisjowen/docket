import { createHash } from 'node:crypto'

/** A request cognee answered with an error status. `retryable` says whether sending it again could succeed. */
export class CogneeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'CogneeHttpError'
  }
}

/** cognee could not be reached at all. */
export class CogneeUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CogneeUnavailableError'
  }
}

/** One data item in a dataset, as `GET /api/v1/datasets/{id}/data` lists it. */
export interface CogneeData {
  id: string
  name?: string
  /** The metadata the item was added with, as an object. */
  externalMetadata?: Record<string, unknown> | null
  /** MD5 of the bytes added. */
  contentHash?: string
}

/** One chunk a `CHUNKS` search returned. */
export interface CogneeChunk {
  id: string
  text: string
  /** The data item the chunk was cut from. */
  document_id?: string
  /** Its data item's metadata - a JSON string in 1.6.8. */
  external_metadata?: unknown
  /** Cosine distance to the question: lower is closer. */
  score?: number
}

export interface CogneeHealth {
  status?: string
  health?: string
  version?: string
}

export interface RequestOptions {
  signal?: AbortSignal | undefined
  /** Overrides the client's own bound for this request. */
  timeoutMs?: number | undefined
}

export interface CogneeClientOptions {
  url: string
  /** The API key, sent as `X-Api-Key` when there is one. Read on first use. */
  apiKey?: (() => Promise<string | undefined>) | undefined
  timeoutMs: number
  fetch?: typeof fetch
}

/** `GET /data` pages at most this many items. */
export const DATA_PAGE = 1000

/** The MD5 cognee identifies added content by (`contentHash`), over exactly the bytes sent. */
export const contentHash = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex')

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

/** The part of an error body worth showing: FastAPI's `detail`, or the body cut short. */
const detailOf = (body: string): string => {
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (detail !== undefined) return JSON.stringify(detail).slice(0, 300)
  } catch {
    // Not JSON: show it as it came.
  }
  return body.slice(0, 300)
}

/**
 * The slice of cognee's REST API (pinned: 1.6.8) the adapter needs: health,
 * datasets and their data items, add, cognify and search. Plain HTTP, so no
 * cognee package or Python runs in the docket process.
 */
export class CogneeClient {
  private readonly base: string
  private readonly fetch: typeof fetch
  private apiKey: Promise<string | undefined> | undefined

  constructor(private readonly options: CogneeClientOptions) {
    this.base = options.url.replace(/\/+$/, '')
    this.fetch = options.fetch ?? fetch
  }

  /** `GET /health`, which needs no key. */
  async health(options: RequestOptions = {}): Promise<CogneeHealth> {
    return ((await this.request('GET', '/health', undefined, options)) ?? {}) as CogneeHealth
  }

  /** The id of the caller's dataset called `name`, or undefined when there is none yet. */
  async findDataset(name: string, options: RequestOptions = {}): Promise<string | undefined> {
    const datasets = await this.request('GET', '/api/v1/datasets', undefined, options)
    const found = (Array.isArray(datasets) ? datasets : []).find(
      (dataset): dataset is { id: string } => (dataset as { name?: unknown })?.name === name && typeof (dataset as { id?: unknown }).id === 'string'
    )
    return found?.id
  }

  /** Every data item in the dataset - or, with `hash`, those whose content has that MD5. */
  async listData(datasetId: string, options: RequestOptions & { hash?: string } = {}): Promise<CogneeData[]> {
    const items: CogneeData[] = []
    for (let offset = 0; ; offset += DATA_PAGE) {
      const query = new URLSearchParams({ limit: String(DATA_PAGE), offset: String(offset), ...(options.hash ? { content_hash: options.hash } : {}) })
      const page = await this.request('GET', `/api/v1/datasets/${encodeURIComponent(datasetId)}/data?${query}`, undefined, options)
      if (!Array.isArray(page)) throw new CogneeHttpError('cognee listed a dataset\'s data as something other than a list', 200, true)
      items.push(...page.filter((item): item is CogneeData => typeof (item as { id?: unknown })?.id === 'string'))
      if (page.length < DATA_PAGE) return items
    }
  }

  /** How many data items the dataset holds. */
  async countData(datasetId: string, options: RequestOptions = {}): Promise<number | undefined> {
    const answer = (await this.request('GET', `/api/v1/datasets/${encodeURIComponent(datasetId)}/data/count`, undefined, options)) as { count?: unknown } | null
    return typeof answer?.count === 'number' ? answer.count : undefined
  }

  /**
   * Adds `text` to the dataset as one file named `name`, with `metadata` as
   * its external metadata, without cognifying it. Content cognee already
   * holds in the dataset is not added again: the existing item's id comes back.
   */
  async add(
    dataset: { name: string; id?: string | undefined },
    file: { name: string; text: string; metadata: Record<string, unknown> },
    options: RequestOptions = {}
  ): Promise<{ datasetId: string; dataId: string }> {
    const form = new FormData()
    form.append('data', new Blob([file.text], { type: 'text/markdown' }), file.name)
    form.append('external_metadata', JSON.stringify([file.metadata]))
    if (dataset.id !== undefined) form.append('datasetId', dataset.id)
    else form.append('datasetName', dataset.name)
    const answer = (await this.request('POST', '/api/v1/add', form, options)) as { dataset_id?: unknown; data_ids?: unknown; status?: unknown } | null
    const dataId = Array.isArray(answer?.data_ids) ? answer.data_ids[0] : undefined
    if (typeof answer?.dataset_id !== 'string' || typeof dataId !== 'string') {
      throw new CogneeHttpError(`cognee did not say what it added (${String(answer?.status ?? 'no status')})`, 200, true)
    }
    return { datasetId: answer.dataset_id, dataId }
  }

  /** Deletes one data item with everything cognify derived from it. Deleting what is gone is not an error. */
  async deleteData(datasetId: string, dataId: string, options: RequestOptions = {}): Promise<void> {
    try {
      await this.request('DELETE', `/api/v1/datasets/${encodeURIComponent(datasetId)}/data/${encodeURIComponent(dataId)}`, undefined, options)
    } catch (error) {
      if (error instanceof CogneeHttpError && error.status === 404) return
      throw error
    }
  }

  /**
   * Cognifies the dataset and waits for it to finish: chunks, embeds and
   * extracts the graph of every item not cognified yet. Items already done
   * are skipped, so running it again is cheap.
   */
  async cognify(datasetId: string, options: RequestOptions = {}): Promise<void> {
    const answer = await this.request('POST', '/api/v1/cognify', { dataset_ids: [datasetId], run_in_background: false }, options)
    for (const run of Object.values((answer ?? {}) as Record<string, unknown>)) {
      const { status, payload } = (run ?? {}) as { status?: unknown; payload?: unknown }
      if (typeof status === 'string' && /errored/i.test(status)) {
        throw new CogneeHttpError(`cognee could not cognify the dataset: ${typeof payload === 'string' ? payload : JSON.stringify(payload ?? status).slice(0, 300)}`, 200, true)
      }
    }
  }

  /** `POST /api/v1/search` with the given payload, returning what cognee answered. */
  async search(payload: Record<string, unknown>, options: RequestOptions = {}): Promise<unknown> {
    return this.request('POST', '/api/v1/search', payload, options)
  }

  private async request(method: string, path: string, body: FormData | Record<string, unknown> | undefined, options: RequestOptions): Promise<unknown> {
    this.apiKey ??= this.options.apiKey?.() ?? Promise.resolve(undefined)
    const apiKey = await this.apiKey
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.options.timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.fetch(`${this.base}${path}`, {
        method,
        headers: {
          ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...(apiKey ? { 'X-Api-Key': apiKey } : {})
        },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
        signal
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      const why = timeout.aborted ? `did not answer within ${options.timeoutMs ?? this.options.timeoutMs} ms` : (error as Error).message
      throw new CogneeUnavailableError(`cognee at ${this.base} ${method} ${path.split('?')[0]}: ${why}`, { cause: error })
    }
    const text = await response.text()
    if (!response.ok) {
      const hint = response.status === 401 ? ' - set the API key variable this instance names (apiKeyEnv)' : ''
      throw new CogneeHttpError(`cognee ${method} ${path.split('?')[0]} failed: ${response.status} ${detailOf(text)}${hint}`, response.status, RETRYABLE.has(response.status))
    }
    if (!text) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new CogneeHttpError(`cognee ${method} ${path.split('?')[0]} answered with something other than JSON`, response.status, true)
    }
  }
}
