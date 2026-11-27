// SPDX-License-Identifier: AGPL-3.0-only
import { createPrivateKey, createSign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * The Docket Cloud GitHub App (§14.1): its JWT, installation tokens, and a
 * small REST client over them. Installed by an org admin on chosen repos, it
 * reads `.docket/` (`contents: read`, `metadata: read`) and, where a connection
 * enables export, opens PRs (`contents: write`, `pull_requests: write`).
 *
 * The private key and installation tokens stay in this process: never logged,
 * never stored.
 */
export interface GitHubAppConfig {
  appId: string
  /** The app's PEM private key (PKCS#1 as GitHub issues it, or PKCS#8). */
  privateKey: string
  /** The app's URL name: `https://github.com/apps/<slug>`. */
  slug: string
  /** `https://api.github.com`, or a fake in tests. */
  apiBase?: string
  /** `https://github.com`, or a fake in tests. */
  webBase?: string
  fetch?: typeof fetch
  /** Milliseconds since the epoch. */
  now?: () => number
}

/** GitHub answered a call with an error status. */
export class GitHubApiError extends Error {
  override name = 'GitHubApiError'
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    detail: string,
  ) {
    super(`GitHub ${method} ${path} answered ${status}${detail ? `: ${detail}` : ''}`)
  }
}

export interface Installation {
  id: number
  account: { login: string; type: string }
  repositorySelection: 'all' | 'selected'
  suspended: boolean
}

export interface Repository {
  id: number
  fullName: string
  defaultBranch: string
  private: boolean
}

/** A REST client acting as one installation (or, for user calls, as a user). */
export interface GitHubClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
}

export interface GitHubApp {
  readonly slug: string
  /** Where an org admin installs the app; GitHub sends `state` back to the setup URL. */
  installUrl(state: string): string
  /** The app's view of an installation. */
  installation(installationId: number): Promise<Installation>
  /** A client with a cached installation token (renewed 5 minutes before it expires). */
  client(installationId: number): GitHubClient
  /** The repos an installation may read, sorted by name. */
  repositories(installationId: number): Promise<Repository[]>
  /** Installations a user may access, from their user-to-server token: proof an admin may link one. */
  userInstallations(userToken: string): Promise<number[]>
}

const API_VERSION = '2022-11-28'
const TIMEOUT_MS = 15_000

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')

/** The app's JWT (RS256): issued a minute in the past for clock drift, valid for nine minutes. */
export function appJwt(appId: string, key: KeyObject | string, nowMs: number = Date.now()): string {
  const now = Math.floor(nowMs / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const signature = signer.sign(typeof key === 'string' ? createPrivateKey(key) : key)
  return `${header}.${payload}.${base64url(signature)}`
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    return typeof body.message === 'string' ? body.message.slice(0, 200) : ''
  } catch {
    return ''
  }
}

/** A REST client with one way of authenticating every call. */
export function restClient(options: {
  apiBase: string
  authorization: () => Promise<string>
  fetch?: typeof fetch
}): GitHubClient {
  const doFetch = options.fetch ?? fetch
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await doFetch(new URL(path, options.apiBase), {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: await options.authorization(),
          'x-github-api-version': API_VERSION,
          'user-agent': 'docket-cloud',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) throw new GitHubApiError(response.status, method, path, await errorDetail(response))
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    },
  }
}

type InstallationBody = {
  id: number
  account: { login: string; type: string } | null
  repository_selection: 'all' | 'selected'
  suspended_at: string | null
}

type RepositoryBody = { id: number; full_name: string; default_branch: string; private: boolean }

export function githubApp(config: GitHubAppConfig): GitHubApp {
  const apiBase = config.apiBase ?? 'https://api.github.com'
  const webBase = config.webBase ?? 'https://github.com'
  const now = config.now ?? Date.now
  const key = createPrivateKey(config.privateKey)
  const tokens = new Map<number, { token: string; expiresAt: number }>()
  const pending = new Map<number, Promise<string>>()

  const asApp = restClient({
    apiBase,
    authorization: async () => `Bearer ${appJwt(config.appId, key, now())}`,
    ...(config.fetch ? { fetch: config.fetch } : {}),
  })

  async function freshToken(installationId: number): Promise<string> {
    const body = await asApp.request<{ token: string; expires_at: string }>(
      'POST',
      `/app/installations/${installationId}/access_tokens`,
    )
    tokens.set(installationId, { token: body.token, expiresAt: Date.parse(body.expires_at) })
    return body.token
  }

  async function installationToken(installationId: number): Promise<string> {
    const cached = tokens.get(installationId)
    if (cached && cached.expiresAt - now() > 5 * 60_000) return cached.token
    let inFlight = pending.get(installationId)
    if (!inFlight) {
      inFlight = freshToken(installationId).finally(() => pending.delete(installationId))
      pending.set(installationId, inFlight)
    }
    return inFlight
  }

  const client = (installationId: number) =>
    restClient({
      apiBase,
      authorization: async () => `token ${await installationToken(installationId)}`,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    })

  return {
    slug: config.slug,
    installUrl(state) {
      const url = new URL(`/apps/${encodeURIComponent(config.slug)}/installations/new`, webBase)
      url.searchParams.set('state', state)
      return url.toString()
    },
    async installation(installationId) {
      const body = await asApp.request<InstallationBody>('GET', `/app/installations/${installationId}`)
      return {
        id: body.id,
        account: { login: body.account?.login ?? 'unknown', type: body.account?.type ?? 'unknown' },
        repositorySelection: body.repository_selection,
        suspended: body.suspended_at !== null,
      }
    },
    client,
    async repositories(installationId) {
      const repos: Repository[] = []
      const api = client(installationId)
      for (let page = 1; page <= 10; page += 1) {
        const body = await api.request<{ repositories: RepositoryBody[] }>(
          'GET',
          `/installation/repositories?per_page=100&page=${page}`,
        )
        repos.push(
          ...body.repositories.map((repo) => ({
            id: repo.id,
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
            private: repo.private,
          })),
        )
        if (body.repositories.length < 100) break
      }
      return repos.sort((a, b) => a.fullName.localeCompare(b.fullName))
    },
    async userInstallations(userToken) {
      const asUser = restClient({
        apiBase,
        authorization: async () => `Bearer ${userToken}`,
        ...(config.fetch ? { fetch: config.fetch } : {}),
      })
      const ids: number[] = []
      for (let page = 1; page <= 10; page += 1) {
        const body = await asUser.request<{ installations: { id: number }[] }>(
          'GET',
          `/user/installations?per_page=100&page=${page}`,
        )
        ids.push(...body.installations.map((installation) => installation.id))
        if (body.installations.length < 100) break
      }
      return ids
    },
  }
}

/**
 * The app from the environment, or null until it is configured:
 * `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and the private key in
 * `GITHUB_APP_PRIVATE_KEY_FILE` (a mounted Secret, which may not exist yet) or
 * `GITHUB_APP_PRIVATE_KEY`. `GITHUB_API_URL` and `GITHUB_OAUTH_URL` point at a
 * fake in tests.
 */
export function githubAppConfigFromEnv(env: Record<string, string | undefined>): GitHubAppConfig | null {
  const appId = env.GITHUB_APP_ID
  const slug = env.GITHUB_APP_SLUG
  const privateKey = env.GITHUB_APP_PRIVATE_KEY_FILE ? readOptionalFile(env.GITHUB_APP_PRIVATE_KEY_FILE) : env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !slug || !privateKey?.trim()) return null
  return {
    appId,
    slug,
    privateKey,
    ...(env.GITHUB_API_URL ? { apiBase: env.GITHUB_API_URL } : {}),
    ...(env.GITHUB_OAUTH_URL ? { webBase: env.GITHUB_OAUTH_URL } : {}),
  }
}

/** A mounted Secret's file, or null while the Secret does not exist (an optional volume is empty). */
export function readOptionalFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
