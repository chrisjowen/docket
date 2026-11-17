import { describe, expect, it } from 'vitest'

import { DocumentError, checkDocument, cloudDocumentPath, pathProblem } from './documents.js'

describe('the rules a canonical document is held to', () => {
  it('takes a relative Markdown path with no empty, "." or ".." segments', () => {
    expect(pathProblem('.docket/resources/service/orders.md')).toBeNull()
    expect(pathProblem('')).toMatch(/1-512/)
    expect(pathProblem(`${'a/'.repeat(300)}x.md`)).toMatch(/1-512/)
    expect(pathProblem('/etc/passwd.md')).toMatch(/relative path/)
    expect(pathProblem('a\\b.md')).toMatch(/relative path/)
    expect(pathProblem('a/../b.md')).toMatch(/segments/)
    expect(pathProblem('a//b.md')).toMatch(/segments/)
    expect(pathProblem('notes.txt')).toMatch(/Markdown/)
  })

  it('puts a document written through the server where a repo would hold it', () => {
    expect(cloudDocumentPath({ id: 'service.orders', type: 'service' })).toBe('.docket/resources/service/orders.md')
    expect(cloudDocumentPath({ id: 'Orders API!', type: 'api' })).toBe('.docket/resources/api/orders-api.md')
    expect(cloudDocumentPath({ id: '...', type: '' })).toBe('.docket/resources/resource/resource.md')
  })

  it('checks a document as the store will hold it: its path, size and frontmatter', () => {
    const raw = '---\nid: team.a\ntype: team\ntitle: A\n---\nNotes.\n'
    expect(checkDocument('.docket/a.md', raw)).toMatchObject({ id: 'team.a', type: 'team', title: 'A' })
    expect(() => checkDocument('../a.md', raw)).toThrow(DocumentError)
    expect(() => checkDocument('.docket/a.md', `${raw}${'x'.repeat(64 * 1024)}`)).toThrow(expect.objectContaining({ code: 'too-large' }))
    const invalid = (() => {
      try {
        checkDocument('.docket/a.md', 'no frontmatter')
      } catch (caught) {
        return caught
      }
    })()
    expect(invalid).toMatchObject({ code: 'invalid' })
    expect((invalid as DocumentError).diagnostics.length).toBeGreaterThan(0)
  })
})
