// SPDX-License-Identifier: AGPL-3.0-only
import { inviteEmailAddress, markInviteEmailed, type IssuedInvite } from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'

import type { Invited } from './grants'
import type { Mail } from './mail'
import { getRuntime } from './runtime'

/**
 * Invite links and emails (tenancy v2 §6). An invite carries a role on a
 * place, lasts 7 days and works once, by link and by email. The link is
 * shown once to whoever invites, and emailed to the address the invite is
 * for, or to the address of the person a GitHub-login invite is for when they
 * have signed in here before.
 */

/** Where an invite's link opens: its own page, which signs them in and asks them to accept. */
export function inviteLink(origin: string, secret: string): string {
  return new URL(`/invite/${secret}`, origin).toString()
}

/** What the invite reads as, in a few words: "Writer on Engineering", or "Owner". */
export function inviteGives(invite: Pick<IssuedInvite, 'owner' | 'roleName' | 'guest'>, placeName: string): string {
  if (invite.owner) return 'Owner'
  return `${invite.roleName} on ${placeName}${invite.guest ? ', as a guest' : ''}`
}

/** The email an invite sends. Its link is the only way in for someone invited by an address GitHub does not know them by. */
export function inviteEmail(input: { to: string; accountName: string; gives: string; invitedBy: string; link: string; expiresAt: Date }): Mail {
  const until = input.expiresAt.toISOString().slice(0, 10)
  return {
    to: input.to,
    subject: `@${input.invitedBy} invited you to ${input.accountName} on Docket`,
    text: [
      `@${input.invitedBy} invited you to ${input.accountName} on Docket, as ${input.gives}.`,
      '',
      'Open this link and sign in with GitHub to accept:',
      input.link,
      '',
      `The link works once, until ${until}. If you were not expecting it, ignore this email.`,
    ].join('\n'),
  }
}

/** What happened to an invite once it was made: its link, and where it was emailed, if anywhere. */
export interface SentInvite {
  link: string
  /** The address it was emailed to; null when there was none, or sending failed. */
  emailedTo: string | null
  /** Whether the server's mailer really delivers (`DOCKET_MAIL`): if not, the link must be passed on by hand. */
  delivers: boolean
}

/**
 * Sends an invite's email, once the invite is saved. Sending never undoes
 * the invite: a failure is logged, and the page shows the link to pass on.
 */
export async function sendInvite(
  invite: IssuedInvite,
  context: { accountName: string; placeName: string; invitedBy: string; requestId?: string },
): Promise<SentInvite> {
  const { router, origin, mailer } = getRuntime()
  const link = inviteLink(origin, invite.linkSecret)
  const to = await router.withPlatform((tx) => inviteEmailAddress(tx, invite))
  if (!to) return { link, emailedTo: null, delivers: mailer.delivers }
  try {
    await mailer.send(inviteEmail({ to, accountName: context.accountName, gives: inviteGives(invite, context.placeName), invitedBy: context.invitedBy, link, expiresAt: invite.expiresAt }))
    await router.withPlatform((tx) => markInviteEmailed(tx, { inviteId: invite.id, to }))
    return { link, emailedTo: to, delivers: mailer.delivers }
  } catch (cause) {
    console.error(`[${context.requestId ?? '-'}] invite email for ${invite.id}: ${cause instanceof Error ? cause.message : String(cause)}`)
    return { link, emailedTo: null, delivers: mailer.delivers }
  }
}

/** How a page says where an invite went. */
export function sentNote(sent: SentInvite): string {
  if (sent.emailedTo && sent.delivers) return `We emailed the link to ${sent.emailedTo}; you can also pass it on yourself.`
  return 'Pass the link on to them: it works once, for 7 days.'
}

/** Who an invite is for, as a page says it: `@login`, or the address. */
export const inviteeOf = (invite: Pick<IssuedInvite, 'githubLogin' | 'email'>) => (invite.githubLogin ? `@${invite.githubLogin}` : (invite.email ?? ''))

/** Sends a just-made (or just-renewed) invite, and what the page that made it shows: once, its link. */
export async function invitedView(event: RequestEvent, accountName: string, invite: IssuedInvite, placeName: string): Promise<{ flash: string; invited: Invited }> {
  const invitedBy = event.locals.user?.login ?? invite.invitedByLogin
  const sent = await sendInvite(invite, { accountName, placeName, invitedBy, requestId: event.locals.requestId })
  const gives = inviteGives(invite, placeName)
  const to = inviteeOf(invite)
  return {
    flash: `Invited ${to} as ${gives}. ${sentNote(sent)}`,
    invited: { to, gives, link: sent.link, emailedTo: sent.emailedTo, note: sentNote(sent) },
  }
}
