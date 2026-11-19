import { describe, expect, it } from 'vitest'

import { directoryAttributes, findPerson, parsePeople } from './directory.js'

const PEOPLE = `
me: dana
people:
  dana:
    name: Dana Ruiz
    aliases: [druiz, Dana@Acme.com]
    role: lead
    team: payments
    flags: [trusted-reviewer]
    shoe_size: 9
  tom:
    role: intern
  sam:
`

describe('the people directory', () => {
  it('reads each person: a name, aliases, and every other key as an attribute', () => {
    const { directory, diagnostics } = parsePeople(PEOPLE, '.docket/people.yaml')
    expect(diagnostics).toEqual([])
    expect(directory.me).toBe('dana')
    expect(directory.people.dana).toEqual({
      name: 'Dana Ruiz',
      aliases: ['druiz', 'Dana@Acme.com'],
      attributes: { role: 'lead', team: 'payments', flags: ['trusted-reviewer'], shoe_size: 9 }
    })
    expect(directory.people.sam).toEqual({ attributes: {} })
  })

  it('finds a person by id or by any alias, in any case', () => {
    const { directory } = parsePeople(PEOPLE, 'people.yaml')
    expect(findPerson(directory, 'dana')).toBe('dana')
    expect(findPerson(directory, 'DRUIZ')).toBe('dana')
    expect(findPerson(directory, 'dana@acme.com')).toBe('dana')
    expect(findPerson(directory, 'nobody')).toBeUndefined()
  })

  it('attests only the attributes the source type declares and lets the directory set', () => {
    const { directory } = parsePeople(PEOPLE, 'people.yaml')
    const person = {
      kind: 'identity' as const,
      attributes: {
        role: { type: 'string' as const, setBy: 'directory' as const },
        team: { type: 'string' as const, setBy: 'reporter' as const },
        flags: { type: 'string[]' as const, setBy: 'directory' as const }
      }
    }
    expect(directoryAttributes(directory, person, 'druiz')).toEqual({ role: 'lead', flags: ['trusted-reviewer'] })
    expect(directoryAttributes(directory, person, 'nobody')).toBeUndefined()
  })

  it('reports a file that does not load, and reads it as no one', () => {
    expect(parsePeople('people: [\n', 'people.yaml')).toEqual({
      directory: { people: {} },
      diagnostics: [expect.objectContaining({ severity: 'error', code: 'people-parse-error', path: 'people.yaml' })]
    })
    expect(parsePeople('people:\n  "bad id": {}\n', 'people.yaml').diagnostics).toEqual([
      expect.objectContaining({ code: 'people-invalid', message: expect.stringContaining('people.bad id') })
    ])
  })
})
