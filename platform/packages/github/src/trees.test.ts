// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { EXPORT_BRANCH_PREFIX, exportBranchName } from './export.js'
import { configPathOf, diffTrees, directoryProblem, docketLayout, isDocketDocument, repoPath } from './trees.js'

describe('docketLayout', () => {
  it('reads .docket/ with docket’s default globs when the repo has no .docket.yaml', () => {
    const layout = docketLayout('.docket/', null)
    expect(layout).toEqual({
      root: '.docket',
      include: ['**/*.md'],
      exclude: ['.index/**', '.cache/**'],
      ontologyPath: '.docket/entities.yaml',
      notices: [],
    })
    expect(isDocketDocument(layout, '.docket/resources/service/orders.md')).toBe(true)
    expect(isDocketDocument(layout, '.docket/.index/manifest.md')).toBe(false)
    expect(isDocketDocument(layout, '.docket/entities.yaml')).toBe(false)
    expect(isDocketDocument(layout, 'docs/readme.md')).toBe(false)
  })

  it('takes source.root, include and exclude from .docket.yaml and ignores adapters and runtimes, with a notice', () => {
    const layout = docketLayout(
      'services/orders/.docket',
      `version: 2
source:
  root: knowledge
  include: ['resources/**/*.md']
  exclude: ['resources/drafts/**']
adapters:
  - id: evil
    module: ./steal-secrets.js
runtimes:
  db: { kind: docker }
`,
    )
    expect(layout.root).toBe('services/orders/knowledge')
    expect(layout.ontologyPath).toBe('services/orders/knowledge/entities.yaml')
    expect(layout.notices).toEqual([
      'services/orders/.docket.yaml names adapters and runtimes; Docket Cloud runs its own adapters and ignores them.',
      'services/orders/.docket.yaml sets source.root, so the sync reads services/orders/knowledge/.',
    ])
    expect(isDocketDocument(layout, 'services/orders/knowledge/resources/service/a.md')).toBe(true)
    expect(isDocketDocument(layout, 'services/orders/knowledge/resources/drafts/b.md')).toBe(false)
    expect(isDocketDocument(layout, 'services/orders/knowledge/notes.md')).toBe(false)
  })

  it('says nothing about an empty adapters list', () => {
    expect(docketLayout('.docket', 'version: 2\nadapters: []\n').notices).toEqual([])
  })

  it('refuses a source.root that leaves the repo, and survives a .docket.yaml that is not YAML', () => {
    expect(docketLayout('.docket', 'source:\n  root: ../../etc\n').root).toBe('.docket')
    expect(docketLayout('.docket', 'source:\n  root: ../../etc\n').notices[0]).toMatch(/is outside the repo/)
    expect(docketLayout('.docket', 'source: [unclosed').notices[0]).toMatch(/is not valid YAML/)
  })

  it('finds .docket.yaml beside the docket root', () => {
    expect(configPathOf('.docket')).toBe('.docket.yaml')
    expect(configPathOf('services/orders/.docket')).toBe('services/orders/.docket.yaml')
  })
})

describe('directoryProblem', () => {
  it('accepts a relative directory and refuses escapes', () => {
    expect(directoryProblem('.docket/')).toBeNull()
    expect(directoryProblem('./services/orders/.docket')).toBeNull()
    expect(directoryProblem('')).not.toBeNull()
    expect(directoryProblem('/etc')).not.toBeNull()
    expect(directoryProblem('a/../../b')).not.toBeNull()
    expect(directoryProblem('a\\b')).not.toBeNull()
  })
})

describe('diffTrees', () => {
  it('fetches new and changed blobs only, and lists what is gone', () => {
    const previous = { 'a.md': '1', 'b.md': '2', 'c.md': '3' }
    const current = new Map([
      ['a.md', '1'],
      ['b.md', '22'],
      ['d.md', '4'],
    ])
    expect(diffTrees(previous, current)).toEqual({ changed: ['b.md', 'd.md'], removed: ['c.md'], unchanged: 1 })
  })
})

describe('export branches and repo paths', () => {
  it('names the branch for the UTC minute', () => {
    expect(exportBranchName(new Date('2026-01-02T03:04:59Z'))).toBe(`${EXPORT_BRANCH_PREFIX}20260102-0304`)
  })

  it('escapes owner and repo in REST paths', () => {
    expect(repoPath('acme/platform')).toBe('/repos/acme/platform')
    expect(() => repoPath('acme/platform/extra')).toThrow()
  })
})
