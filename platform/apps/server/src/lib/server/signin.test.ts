// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { inviteLinkOf, safeNext } from './signin'

describe('safeNext', () => {
  it('keeps a same-site path', () => {
    expect(safeNext('/a/acme/members?tab=invites#top')).toBe('/a/acme/members?tab=invites#top')
  })

  it('refuses anything a browser could read as another origin', () => {
    for (const next of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\r/evil.example',
      '/\n/evil.example',
      '/\u0000/evil.example',
      '/\u007f/evil.example',
      '/a\\b',
    ]) {
      expect(safeNext(next)).toBe('/')
    }
  })
})

describe('inviteLinkOf', () => {
  const link = `dki_${'a'.repeat(32)}`
  it('finds the invite link a sign-in returns to', () => {
    expect(inviteLinkOf(`/invite/${link}`)).toBe(link)
    expect(inviteLinkOf(`/invite/${link}?x=1`)).toBe(link)
  })

  it('finds none anywhere else, or in a path that only looks like one', () => {
    for (const next of [null, '/', '/start', `/invite/${link}x`, `/invite/dki_short`, `//evil.example/invite/${link}`, `/a/acme/invite/${link}`]) {
      expect(inviteLinkOf(next), String(next)).toBeNull()
    }
  })
})
