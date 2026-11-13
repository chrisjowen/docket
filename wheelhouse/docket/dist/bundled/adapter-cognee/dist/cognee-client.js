import { createHash } from 'node:crypto';
/** A request cognee answered with an error status. `retryable` says whether sending it again could succeed. */
export class CogneeHttpError extends Error {
    status;
    retryable;
    constructor(message, status, retryable) {
        super(message);
        this.status = status;
        this.retryable = retryable;
        this.name = 'CogneeHttpError';
    }
}
/** cognee could not be reached at all. */
export class CogneeUnavailableError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'CogneeUnavailableError';
    }
}
/** `GET /data` pages at most this many items. */
export const DATA_PAGE = 1000;
/** The MD5 cognee identifies added content by (`contentHash`), over exactly the bytes sent. */
export const contentHash = (text) => createHash('md5').update(text, 'utf8').digest('hex');
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
/** The part of an error body worth showing: FastAPI's `detail`, or the body cut short. */
const detailOf = (body) => {
    try {
        const detail = JSON.parse(body).detail;
        if (typeof detail === 'string')
            return detail;
        if (detail !== undefined)
            return JSON.stringify(detail).slice(0, 300);
    }
    catch {
        // Not JSON: show it as it came.
    }
    return body.slice(0, 300);
};
/**
 * The slice of cognee's REST API (pinned: 1.6.8) the adapter needs: health,
 * datasets and their data items, add, cognify and search. Plain HTTP, so no
 * cognee package or Python runs in the docket process.
 */
export class CogneeClient {
    options;
    base;
    fetch;
    apiKey;
    constructor(options) {
        this.options = options;
        this.base = options.url.replace(/\/+$/, '');
        this.fetch = options.fetch ?? fetch;
    }
    /** `GET /health`, which needs no key. */
    async health(options = {}) {
        return ((await this.request('GET', '/health', undefined, options)) ?? {});
    }
    /** The id of the caller's dataset called `name`, or undefined when there is none yet. */
    async findDataset(name, options = {}) {
        const datasets = await this.request('GET', '/api/v1/datasets', undefined, options);
        const found = (Array.isArray(datasets) ? datasets : []).find((dataset) => dataset?.name === name && typeof dataset.id === 'string');
        return found?.id;
    }
    /** Every data item in the dataset - or, with `hash`, those whose content has that MD5. */
    async listData(datasetId, options = {}) {
        const items = [];
        for (let offset = 0;; offset += DATA_PAGE) {
            const query = new URLSearchParams({ limit: String(DATA_PAGE), offset: String(offset), ...(options.hash ? { content_hash: options.hash } : {}) });
            const page = await this.request('GET', `/api/v1/datasets/${encodeURIComponent(datasetId)}/data?${query}`, undefined, options);
            if (!Array.isArray(page))
                throw new CogneeHttpError('cognee listed a dataset\'s data as something other than a list', 200, true);
            items.push(...page.filter((item) => typeof item?.id === 'string'));
            if (page.length < DATA_PAGE)
                return items;
        }
    }
    /** How many data items the dataset holds. */
    async countData(datasetId, options = {}) {
        const answer = (await this.request('GET', `/api/v1/datasets/${encodeURIComponent(datasetId)}/data/count`, undefined, options));
        return typeof answer?.count === 'number' ? answer.count : undefined;
    }
    /**
     * Adds `text` to the dataset as one file named `name`, with `metadata` as
     * its external metadata, without cognifying it. Content cognee already
     * holds in the dataset is not added again: the existing item's id comes back.
     */
    async add(dataset, file, options = {}) {
        const form = new FormData();
        form.append('data', new Blob([file.text], { type: 'text/markdown' }), file.name);
        form.append('external_metadata', JSON.stringify([file.metadata]));
        if (dataset.id !== undefined)
            form.append('datasetId', dataset.id);
        else
            form.append('datasetName', dataset.name);
        const answer = (await this.request('POST', '/api/v1/add', form, options));
        const dataId = Array.isArray(answer?.data_ids) ? answer.data_ids[0] : undefined;
        if (typeof answer?.dataset_id !== 'string' || typeof dataId !== 'string') {
            throw new CogneeHttpError(`cognee did not say what it added (${String(answer?.status ?? 'no status')})`, 200, true);
        }
        return { datasetId: answer.dataset_id, dataId };
    }
    /** Deletes one data item with everything cognify derived from it. Deleting what is gone is not an error. */
    async deleteData(datasetId, dataId, options = {}) {
        try {
            await this.request('DELETE', `/api/v1/datasets/${encodeURIComponent(datasetId)}/data/${encodeURIComponent(dataId)}`, undefined, options);
        }
        catch (error) {
            if (error instanceof CogneeHttpError && error.status === 404)
                return;
            throw error;
        }
    }
    /**
     * Cognifies the dataset and waits for it to finish: chunks, embeds and
     * extracts the graph of every item not cognified yet. Items already done
     * are skipped, so running it again is cheap.
     */
    async cognify(datasetId, options = {}) {
        const answer = await this.request('POST', '/api/v1/cognify', { dataset_ids: [datasetId], run_in_background: false }, options);
        for (const run of Object.values((answer ?? {}))) {
            const { status, payload } = (run ?? {});
            if (typeof status === 'string' && /errored/i.test(status)) {
                throw new CogneeHttpError(`cognee could not cognify the dataset: ${typeof payload === 'string' ? payload : JSON.stringify(payload ?? status).slice(0, 300)}`, 200, true);
            }
        }
    }
    /** `POST /api/v1/search` with the given payload, returning what cognee answered. */
    async search(payload, options = {}) {
        return this.request('POST', '/api/v1/search', payload, options);
    }
    async request(method, path, body, options) {
        this.apiKey ??= this.options.apiKey?.() ?? Promise.resolve(undefined);
        const apiKey = await this.apiKey;
        const timeout = AbortSignal.timeout(options.timeoutMs ?? this.options.timeoutMs);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        let response;
        try {
            response = await this.fetch(`${this.base}${path}`, {
                method,
                headers: {
                    ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
                    ...(apiKey ? { 'X-Api-Key': apiKey } : {})
                },
                ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
                signal
            });
        }
        catch (error) {
            if (options.signal?.aborted)
                throw error;
            const why = timeout.aborted ? `did not answer within ${options.timeoutMs ?? this.options.timeoutMs} ms` : error.message;
            throw new CogneeUnavailableError(`cognee at ${this.base} ${method} ${path.split('?')[0]}: ${why}`, { cause: error });
        }
        const text = await response.text();
        if (!response.ok) {
            const hint = response.status === 401 ? ' - set the API key variable this instance names (apiKeyEnv)' : '';
            throw new CogneeHttpError(`cognee ${method} ${path.split('?')[0]} failed: ${response.status} ${detailOf(text)}${hint}`, response.status, RETRYABLE.has(response.status));
        }
        if (!text)
            return null;
        try {
            return JSON.parse(text);
        }
        catch {
            throw new CogneeHttpError(`cognee ${method} ${path.split('?')[0]} answered with something other than JSON`, response.status, true);
        }
    }
}
