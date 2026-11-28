// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { safeNext } from './signin'

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
