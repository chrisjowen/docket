// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { inviteEmail, inviteGives } from './invites'
import { logMailer, mailerFrom, memoryMailer, noMailer } from './mail'

describe('mailers', () => {
  it('log an email by its address and subject, never its body, which carries a one-use link', async () => {
    const lines: string[] = []
    await logMailer((line) => lines.push(line)).send({ to: 'pat@example.com', subject: 'Join Acme', text: 'https://docket.example/invite/dki_secret' })
    expect(lines).toEqual(['mail (log only, not sent): to pat@example.com: Join Acme'])
  })

  it('keep what a test sends, and pick a mailer by DOCKET_MAIL', async () => {
    const memory = memoryMailer()
    await memory.send({ to: 'a@example.com', subject: 's', text: 't' })
    expect(memory.sent).toEqual([{ to: 'a@example.com', subject: 's', text: 't' }])
    expect(mailerFrom(undefined).kind).toBe('log')
    expect(mailerFrom('').kind).toBe('log')
    expect(mailerFrom('NONE')).toBe(noMailer)
    expect(() => mailerFrom('smtp')).toThrow(/DOCKET_MAIL is log or none/)
  })
})

describe('the invite email', () => {
  it('says who invited whom to what, with the link and until when it works', () => {
    const mail = inviteEmail({
      to: 'pat@example.com',
      accountName: 'Acme',
      gives: inviteGives({ owner: false, roleName: 'Writer', guest: false }, 'Engineering (space)'),
      invitedBy: 'chris',
      link: 'https://docket.example/invite/dki_x',
      expiresAt: new Date('2026-12-05T10:00:00Z'),
    })
    expect(mail.subject).toBe('@chris invited you to Acme on Docket')
    expect(mail.text).toContain('as Writer on Engineering (space).')
    expect(mail.text).toContain('https://docket.example/invite/dki_x')
    expect(mail.text).toContain('until 2026-12-05')
    expect(inviteGives({ owner: true, roleName: 'Admin', guest: false }, 'x')).toBe('Owner')
    expect(inviteGives({ owner: false, roleName: 'Reader', guest: true }, 'Legal (space)')).toBe('Reader on Legal (space), as a guest')
  })
})
