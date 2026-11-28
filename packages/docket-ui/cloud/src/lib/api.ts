// SPDX-License-Identifier: AGPL-3.0-only
import { API_VERSION, compatible, operation, pathOf, type OperationId, type RequestBody, type ResponseBody } from '@docket/api'
import { error, redirect } from '@sveltejs/kit'

/**
 * The web UI's one way to the server: the public API, `/api/v1`, by the
 * operations `@docket/api` defines, on the origin the page came from - the
 * server itself, or a host that serves this UI and passes `/api` through. The
 * session cookie goes with every call; every change carries the session's
 * CSRF token, which `me.get` hands over.
 */

export { API_VERSION }

/** A refusal, as the API words it: `{ error, error_description }`. */
export class ApiError extends Error {
  override name = 'ApiError'
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

let csrf: string | null = null
/** The API version the server last answered with (`X-Docket-Api-Version`). */
let served: string | null = null

/** The session's CSRF token, which every change carries (`X-CSRF-Token`). */
export function useCsrf(token: string | null): void {
  csrf = token
}

type Fetch = typeof fetch

interface Call<Id extends OperationId> {
  params?: Record<string, string>
  query?: Record<string, string | undefined>
  body?: RequestBody<Id>
}

/** Makes one operation's call: JSON in and out, a refusal thrown as an `ApiError`. */
export async function call<Id extends OperationId>(fetcher: Fetch, id: Id, input: Call<Id> = {}): Promise<ResponseBody<Id>> {
  const op = operation(id)
  const query = new URLSearchParams(Object.entries(input.query ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const headers: Record<string, string> = { accept: 'application/json' }
  if (input.body !== undefined) headers['content-type'] = 'application/json'
  if (op.method !== 'GET' && csrf) headers['x-csrf-token'] = csrf
  const response = await fetcher(`${pathOf(op, input.params ?? {})}${query.size ? `?${query}` : ''}`, {
    method: op.method,
    headers,
    credentials: 'same-origin',
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  })
  served = response.headers.get('x-docket-api-version') ?? served
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  if (!response.ok) {
    const problem = (parsed ?? {}) as { error?: string; error_description?: string }
    throw new ApiError(response.status, problem.error ?? 'server_error', problem.error_description ?? (text.trim() || `The server answered ${response.status}.`))
  }
  return parsed as ResponseBody<Id>
}

/**
 * A load's refusal as the page shows it: not signed in goes to the server's sign-in and back; anything else is
 * the error page, with the API's own words.
 */
export function refused(cause: unknown, url: URL): never {
  if (cause instanceof ApiError) {
    if (cause.status === 401) redirect(307, `/signin?next=${encodeURIComponent(url.pathname + url.search)}`)
    error(cause.status, cause.status === 404 ? 'Not found' : cause.message)
  }
  throw cause
}

/**
 * Whether this UI fits the API its server answered with: a UI built for another major version, or a newer
 * minor, says so rather than call operations that are not there (one hosted apart from its server may be a
 * release ahead of or behind it).
 */
export function checkCompatible(): void {
  if (served && !compatible(API_VERSION, served)) {
    error(502, `This web UI needs version ${API_VERSION} of the Docket API, and the server answers version ${served}. Use the web UI released with your server.`)
  }
}
