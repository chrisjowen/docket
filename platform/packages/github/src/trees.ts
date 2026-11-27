// SPDX-License-Identifier: AGPL-3.0-only
import { posix } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { GitHubApiError, type GitHubClient } from './app.js'

/**
 * Reading a connection's docket files with the Git Trees API (§14.1): walk
 * to the docket root at a commit, list every blob under it with its SHA, and
 * diff those SHAs against the last sync, so only changed files are fetched.
 */

/** The `owner/repo` part of a REST path, each half escaped. */
export function repoPath(fullName: string): string {
  const [owner, name, ...rest] = fullName.split('/')
  if (!owner || !name || rest.length) throw new Error(`not an owner/repo name: ${JSON.stringify(fullName)}`)
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

/** A relative posix directory in the repo, `.` and `..` refused: `.docket/` reads as `.docket`. */
export function directoryProblem(path: string): string | null {
  const trimmed = path.trim().replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (!trimmed) return 'Name a directory in the repo, such as .docket/.'
  if (trimmed.length > 200) return 'A directory path is at most 200 characters.'
  if (trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes('\0')) return 'Use a relative path with forward slashes.'
  if (trimmed.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'A directory path has no empty, "." or ".." segments.'
  }
  return null
}

export function normaliseDirectory(path: string): string {
  const problem = directoryProblem(path)
  if (problem) throw new Error(problem)
  return path.trim().replace(/^\.\/+/, '').replace(/\/+$/, '')
}

/** What a sync reads: which directory holds the docket files, which of them count, and where the ontology is. */
export interface DocketLayout {
  /** The docket root in the repo, no trailing slash: `.docket`, or `services/orders/.docket`. */
  root: string
  /** Globs relative to `root`, as docket's `source.include` and `source.exclude`. */
  include: string[]
  exclude: string[]
  /** The repo's ontology: `<root>/entities.yaml`. */
  ontologyPath: string
  /** What the sync should tell people about the repo's `.docket.yaml`. */
  notices: string[]
}

const DEFAULT_INCLUDE = ['**/*.md']
const DEFAULT_EXCLUDE = ['.index/**', '.cache/**']

/** Where a connection's `.docket.yaml` lives: beside its docket root. */
export function configPathOf(root: string): string {
  const project = posix.dirname(root)
  return project === '.' ? '.docket.yaml' : `${project}/.docket.yaml`
}

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null

/**
 * The layout a connection syncs: its directory, and from the repo's
 * `.docket.yaml` only `source.root`, `source.include` and `source.exclude`.
 * The cloud never loads the adapters or runtimes a customer's config names
 * (§6.4): a config that names them gets a notice, and they are ignored.
 */
export function docketLayout(connectionRoot: string, configText: string | null): DocketLayout {
  const notices: string[] = []
  let root = normaliseDirectory(connectionRoot)
  let include = DEFAULT_INCLUDE
  let exclude = DEFAULT_EXCLUDE
  if (configText !== null) {
    const configPath = configPathOf(root)
    let config: unknown
    try {
      config = parseYaml(configText)
    } catch (cause) {
      config = undefined
      notices.push(`${configPath} is not valid YAML (${(cause as Error).message.split('\n')[0]}); the defaults apply.`)
    }
    if (config && typeof config === 'object') {
      const record = config as Record<string, unknown>
      const named = (value: unknown) =>
        Array.isArray(value) ? value.length > 0 : value !== null && typeof value === 'object' ? Object.keys(value).length > 0 : value !== undefined
      const ignored = ['adapters', 'runtimes', 'projections'].filter((key) => named(record[key]))
      if (ignored.length) {
        notices.push(
          `${configPath} names ${ignored.join(' and ')}; Docket Cloud runs its own adapters and ignores ${ignored.length === 1 ? 'it' : 'them'}.`,
        )
      }
      const source = record.source
      if (source && typeof source === 'object') {
        const fields = source as Record<string, unknown>
        if (typeof fields.root === 'string') {
          const project = posix.dirname(root)
          const declared = posix.normalize(project === '.' ? fields.root : `${project}/${fields.root}`)
          if (directoryProblem(declared) === null) {
            const normalised = normaliseDirectory(declared)
            if (normalised !== root) notices.push(`${configPath} sets source.root, so the sync reads ${normalised}/.`)
            root = normalised
          } else {
            notices.push(`${configPath} source.root ${JSON.stringify(fields.root)} is outside the repo; ${root}/ is read.`)
          }
        }
        include = strings(fields.include) ?? include
        exclude = strings(fields.exclude) ?? exclude
      }
    }
  }
  return { root, include, exclude, ontologyPath: `${root}/entities.yaml`, notices }
}

/** Whether a repo path is a docket document under the layout: a Markdown file its globs include. */
export function isDocketDocument(layout: DocketLayout, path: string): boolean {
  if (!path.startsWith(`${layout.root}/`) || !path.endsWith('.md')) return false
  const relative = path.slice(layout.root.length + 1)
  return (
    layout.include.some((glob) => posix.matchesGlob(relative, glob)) &&
    !layout.exclude.some((glob) => posix.matchesGlob(relative, glob))
  )
}

type TreeEntry = { path: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }
type TreeBody = { sha: string; tree: TreeEntry[]; truncated: boolean }

/** The commit a branch points at now. */
export async function branchHead(client: GitHubClient, repo: string, branch: string): Promise<string> {
  const ref = await client.request<{ object: { sha: string } }>(
    'GET',
    `${repoPath(repo)}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
  )
  return ref.object.sha
}

/** What GitHub says about a repository as a source of evidence: its visibility, and whether the synced branch is protected. */
export interface RepositorySettings {
  visibility: 'public' | 'private' | null
  branchProtected: boolean | null
}

/**
 * Reads a repository's settings, for the source attributes a connection
 * attests (`setBy: connection`). Each is null when GitHub does not say - an
 * error, or a token without the right - and never fails the sync.
 */
export async function repositorySettings(client: GitHubClient, repo: string, branch: string): Promise<RepositorySettings> {
  const [about, head] = await Promise.all([
    client.request<{ private?: boolean }>('GET', repoPath(repo)).catch(() => null),
    client.request<{ protected?: boolean }>('GET', `${repoPath(repo)}/branches/${branch.split('/').map(encodeURIComponent).join('/')}`).catch(() => null),
  ])
  return {
    visibility: typeof about?.private === 'boolean' ? (about.private ? 'private' : 'public') : null,
    branchProtected: typeof head?.protected === 'boolean' ? head.protected : null,
  }
}

/** A commit's root tree. */
export async function commitTree(client: GitHubClient, repo: string, commitSha: string): Promise<string> {
  const commit = await client.request<{ tree: { sha: string } }>('GET', `${repoPath(repo)}/git/commits/${commitSha}`)
  return commit.tree.sha
}

/** The entries of one tree, not recursive. */
async function treeEntries(client: GitHubClient, repo: string, treeSha: string): Promise<TreeEntry[]> {
  return (await client.request<TreeBody>('GET', `${repoPath(repo)}/git/trees/${treeSha}`)).tree
}

/** The blob or tree at a path under a root tree, or null: walks one directory at a time, so a big repo is never listed whole. */
export async function entryAt(
  client: GitHubClient,
  repo: string,
  rootTree: string,
  path: string,
): Promise<{ type: 'blob' | 'tree'; sha: string } | null> {
  let tree = rootTree
  const segments = path.split('/')
  for (const [index, segment] of segments.entries()) {
    const entry = (await treeEntries(client, repo, tree)).find((candidate) => candidate.path === segment)
    if (!entry || entry.type === 'commit') return null
    if (index === segments.length - 1) return { type: entry.type, sha: entry.sha }
    if (entry.type !== 'tree') return null
    tree = entry.sha
  }
  return null
}

export class TreeTooLarge extends Error {
  override name = 'TreeTooLarge'
}

/** Every blob under a directory, by repo path, with its SHA: one recursive read of that subtree. */
export async function blobsUnder(
  client: GitHubClient,
  repo: string,
  rootTree: string,
  directory: string,
): Promise<Map<string, string>> {
  const entry = await entryAt(client, repo, rootTree, directory)
  const blobs = new Map<string, string>()
  if (!entry || entry.type !== 'tree') return blobs
  const body = await client.request<TreeBody>('GET', `${repoPath(repo)}/git/trees/${entry.sha}?recursive=1`)
  if (body.truncated) throw new TreeTooLarge(`${directory}/ has more files than GitHub lists in one tree read`)
  for (const item of body.tree) {
    if (item.type === 'blob') blobs.set(`${directory}/${item.path}`, item.sha)
  }
  return blobs
}

/** A blob's text (UTF-8). */
export async function blobText(client: GitHubClient, repo: string, sha: string): Promise<string> {
  const blob = await client.request<{ content: string; encoding: string }>('GET', `${repoPath(repo)}/git/blobs/${sha}`)
  if (blob.encoding !== 'base64') return blob.content
  return Buffer.from(blob.content, 'base64').toString('utf8')
}

/** A file's text at a commit's tree, or null when there is none. */
export async function fileAt(client: GitHubClient, repo: string, rootTree: string, path: string): Promise<{ sha: string; text: string } | null> {
  const entry = await entryAt(client, repo, rootTree, path)
  if (!entry || entry.type !== 'blob') return null
  return { sha: entry.sha, text: await blobText(client, repo, entry.sha) }
}

export interface TreeDiff {
  /** New or changed blobs: fetch these. */
  changed: string[]
  /** Paths the last sync had that are gone. */
  removed: string[]
  unchanged: number
}

/** Compares blob SHAs by path: what a sync must fetch and what it must retire. */
export function diffTrees(previous: Readonly<Record<string, string>>, current: ReadonlyMap<string, string>): TreeDiff {
  const changed: string[] = []
  let unchanged = 0
  for (const [path, sha] of current) {
    if (previous[path] === sha) unchanged += 1
    else changed.push(path)
  }
  const removed = Object.keys(previous).filter((path) => !current.has(path))
  return { changed: changed.sort(), removed: removed.sort(), unchanged }
}

/** Runs `fn` over items, at most `limit` at a time, keeping their order. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

/** Whether an error says the repo, branch or path is gone, rather than GitHub failing. */
export function isNotFound(error: unknown): boolean {
  return error instanceof GitHubApiError && (error.status === 404 || error.status === 409)
}
