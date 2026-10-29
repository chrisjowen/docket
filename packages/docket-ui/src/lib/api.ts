/**
 * Where the UI reaches `docket open`'s API. Served by docket open itself, that
 * is its own origin; drawn inside another page - Wheelhouse's - it is the
 * viewer's address, which docket open lets that page use (`--allow-origin`).
 */

/** A request to the API, by its path: `/api/graph`. */
export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>

export interface DocketApi {
  /** The viewer's address without a trailing slash; '' for the page's own origin. */
  readonly base: string
  readonly fetch: Fetcher
}

/** The API at `base` - '' (the default) for the origin the page came from. */
export const apiAt = (base = ''): DocketApi => {
  const root = base.replace(/\/+$/, '')
  return { base: root, fetch: (path, init) => fetch(`${root}${path}`, init) }
}
