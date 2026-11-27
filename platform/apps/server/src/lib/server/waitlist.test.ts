// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { parseWaitlistForm } from './waitlist'

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe('parseWaitlistForm', () => {
  it('normalises a complete request', () => {
    expect(parseWaitlistForm(form({ email: ' Sam@Example.COM ', team: ' Platform ', size: '6-20', note: ' services first ' }))).toEqual({
      ok: true,
      request: { email: 'sam@example.com', teamName: 'Platform', teamSize: '6-20', note: 'services first' },
    })
  })

  it('needs only an email and a team name', () => {
    expect(parseWaitlistForm(form({ email: 'sam@example.com', team: 'Platform' }))).toEqual({
      ok: true,
      request: { email: 'sam@example.com', teamName: 'Platform', teamSize: null, note: null },
    })
  })

  it('names each problem, and hands the values back', () => {
    const parsed = parseWaitlistForm(form({ email: 'not-an-email', team: '', size: '3', note: 'x'.repeat(1001) }))
    expect(parsed).toMatchObject({
      ok: false,
      problems: {
        email: 'Enter an email we can reach you at.',
        team: 'Tell us what your team is called.',
        size: 'Pick one of the team sizes.',
        note: 'Keep it to 1000 characters.',
      },
      values: { email: 'not-an-email', size: '3' },
    })
    expect(parseWaitlistForm(form({ email: 'a@b.co', team: 'x'.repeat(121) }))).toMatchObject({ ok: false, problems: { team: 'Keep the team name to 120 characters.' } })
  })

  it('takes no GitHub login from the form', () => {
    expect(parseWaitlistForm(form({ email: 'sam@example.com', team: 'Platform', github: 'sam-dev' }))).toEqual({
      ok: true,
      request: { email: 'sam@example.com', teamName: 'Platform', teamSize: null, note: null },
    })
  })

  it('treats a missing field as empty', () => {
    expect(parseWaitlistForm(new FormData())).toMatchObject({ ok: false, problems: { email: expect.any(String), team: expect.any(String) } })
  })
})
