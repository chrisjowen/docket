// SPDX-License-Identifier: AGPL-3.0-only
import { GitHubApiError, type GitHubClient } from './app.js'
import { branchHead, commitTree, repoPath } from './trees.js'

/**
 * Export back to a repo as a PR (§14.3): the files go on a new branch
 * `docket-cloud/export-<yyyymmdd-hhmm>` in one commit made with the Git Data
 * API, and a PR asks to merge it into the connection's branch. Exports are
 * only ever PRs: the cloud creates its own branch and never moves an existing
 * ref, so it never pushes to a protected or default branch.
 */

export const EXPORT_BRANCH_PREFIX = 'docket-cloud/export-'

/** `docket-cloud/export-20261104-0930`, in UTC. */
export function exportBranchName(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${EXPORT_BRANCH_PREFIX}${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`
}

/** One resource an export carries, as the PR's summary table lists it. */
export interface ExportedResource {
  resourceId: string
  type: string
  path: string
  links: number
  evidence: number
  /** Who wrote it, as people read them (`@alice`). */
  actors: string[]
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')

/** The PR's description: what it carries, in a table, and what merging it does. */
export function exportSummary(input: {
  workspace: string
  resources: readonly ExportedResource[]
  /** The published ontology version, when its `entities.yaml` differs from the repo's. */
  ontology?: { number: number; path: string } | null
  /** Repo files rewritten by an ontology migration. */
  migrated?: readonly string[]
  link?: string
}): string {
  const lines = [
    `Knowledge written in Docket Cloud (workspace **${cell(input.workspace)}**), exported as docket Markdown.`,
    '',
  ]
  if (input.resources.length) {
    lines.push('| Resource | Type | Links | Evidence | Written by | File |', '|---|---|---:|---:|---|---|')
    for (const resource of input.resources) {
      lines.push(
        `| \`${cell(resource.resourceId)}\` | ${cell(resource.type)} | ${resource.links} | ${resource.evidence} | ${cell(resource.actors.join(', ') || 'unknown')} | \`${cell(resource.path)}\` |`,
      )
    }
    const links = input.resources.reduce((sum, resource) => sum + resource.links, 0)
    const evidence = input.resources.reduce((sum, resource) => sum + resource.evidence, 0)
    lines.push('', `${input.resources.length} resource(s), ${links} link(s), ${evidence} evidence item(s).`)
  }
  if (input.ontology) {
    lines.push('', `The ontology is updated to the published version v${input.ontology.number} (\`${cell(input.ontology.path)}\`).`)
  }
  if (input.migrated?.length) {
    lines.push('', 'Rewritten by an ontology migration:', ...input.migrated.map((path) => `- \`${cell(path)}\``))
  }
  lines.push(
    '',
    'Once this merges, the next push syncs these files back in from the repo, and the cloud copies step aside so evidence is not counted twice.',
  )
  if (input.link) lines.push('', `Opened from ${input.link}`)
  return lines.join('\n')
}

export interface ExportFile {
  /** Repo path. */
  path: string
  content: string
}

export interface OpenedPr {
  number: number
  url: string
  branch: string
  commitSha: string
}

/**
 * Commits the files on a new export branch cut from `base`, and opens a PR
 * into `base`. A branch name taken already (two exports in one minute) gets a
 * `-2`, `-3`... suffix; an existing branch is never moved.
 */
export async function openExportPr(
  client: GitHubClient,
  input: { repo: string; base: string; branch: string; files: readonly ExportFile[]; title: string; body: string; message: string },
): Promise<OpenedPr> {
  if (!input.branch.startsWith(EXPORT_BRANCH_PREFIX) || input.branch === input.base) {
    throw new Error(`an export branch is named ${EXPORT_BRANCH_PREFIX}<time>, never the base branch`)
  }
  if (!input.files.length) throw new Error('an export needs at least one file')
  const repo = repoPath(input.repo)
  const parent = await branchHead(client, input.repo, input.base)
  const baseTree = await commitTree(client, input.repo, parent)
  const tree = await client.request<{ sha: string }>('POST', `${repo}/git/trees`, {
    base_tree: baseTree,
    tree: input.files.map((file) => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })),
  })
  const commit = await client.request<{ sha: string }>('POST', `${repo}/git/commits`, {
    message: input.message,
    tree: tree.sha,
    parents: [parent],
  })

  let branch = input.branch
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.request('POST', `${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha })
      break
    } catch (error) {
      // 422: the ref exists. Try the next suffix; never update it.
      if (!(error instanceof GitHubApiError) || error.status !== 422 || attempt >= 9) throw error
      branch = `${input.branch}-${attempt + 1}`
    }
  }

  const pr = await client.request<{ number: number; html_url: string }>('POST', `${repo}/pulls`, {
    title: input.title,
    head: branch,
    base: input.base,
    body: input.body,
    maintainer_can_modify: true,
  })
  return { number: pr.number, url: pr.html_url, branch, commitSha: commit.sha }
}
