// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Email (tenancy v2 §6: invites go by link and email). The server had no
 * mailer before invites needed one, so sending is pluggable: a `Mailer`
 * takes a message and delivers it somehow. `DOCKET_MAIL` picks one:
 *
 * - `log` (the default): writes who it is to and its subject to the server's
 *   log, never its body, which carries a one-use invite link. Nothing leaves
 *   the server; whoever invites copies the link from the page instead.
 * - `none`: sends nothing and logs nothing.
 *
 * Tests use `memoryMailer`, which keeps what it was given and sends nothing.
 * A real transport (SMTP, a provider's API) is one more `Mailer`.
 */

export interface Mail {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  /** What the server's start-up line and the invite page call it. */
  readonly kind: 'log' | 'none' | 'memory'
  /** Whether a message really reaches its address, so a page can say "emailed" or "copy the link". */
  readonly delivers: boolean
  send(mail: Mail): Promise<void>
}

/** Writes each message's address and subject to the log; the body stays out of it. */
export function logMailer(write: (line: string) => void = (line) => console.info(line)): Mailer {
  return {
    kind: 'log',
    delivers: false,
    async send(mail) {
      write(`mail (log only, not sent): to ${mail.to}: ${mail.subject}`)
    },
  }
}

export const noMailer: Mailer = { kind: 'none', delivers: false, send: async () => {} }

/** A test double: keeps every message, sends none. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = []
  return { kind: 'memory', delivers: true, sent, send: async (mail) => void sent.push(mail) }
}

/** The mailer `DOCKET_MAIL` names: `log` (the default) or `none`. */
export function mailerFrom(raw: string | undefined): Mailer {
  const kind = (raw ?? '').trim().toLowerCase() || 'log'
  if (kind === 'log') return logMailer()
  if (kind === 'none') return noMailer
  throw new Error(`DOCKET_MAIL is log or none, not ${raw}`)
}
