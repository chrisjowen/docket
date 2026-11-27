// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { frontmatterOf } from './graph.js'

const doc = (summary: string) => `---\nid: person.alice-hong\ntype: person\ntitle: Alice Hong\nsummary: ${summary}\ntags: [email]\n---\nBody.\n`

describe('frontmatterOf', () => {
  it('reads a summary however YAML writes it', () => {
    expect(frontmatterOf(doc('|\n  Alice Hong sent Chris an email.\n  She seemed dismissive about Sophia.')).summary).toBe(
      'Alice Hong sent Chris an email.\nShe seemed dismissive about Sophia.\n',
    )
    expect(frontmatterOf(doc('>-\n  Alice Hong sent Chris\n  an email.')).summary).toBe('Alice Hong sent Chris an email.')
    expect(frontmatterOf(doc('"She said \\"no\\"."')).summary).toBe('She said "no".')
    expect(frontmatterOf(doc("'it''s fine'")).summary).toBe("it's fine")
    expect(frontmatterOf(doc('Alice\'s manager')).summary).toBe("Alice's manager")
    expect(frontmatterOf(doc('')).summary).toBeNull()
  })

  it('reads nothing from a document without frontmatter, or one that cannot be read', () => {
    expect(frontmatterOf(undefined)).toEqual({})
    expect(frontmatterOf('---\nsummary: [unclosed\n---\n')).toEqual({})
  })
})
