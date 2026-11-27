// SPDX-License-Identifier: AGPL-3.0-only
import { isTeamSize, normaliseEmail, type TeamSize, type WaitlistRequest } from '@docket/platform-tenancy'

export type WaitlistField = 'email' | 'team' | 'size' | 'note'

/** What the form sent back, to fill it again after a refusal. */
export interface WaitlistValues {
  email: string
  team: string
  size: string
  note: string
}

export type ParsedWaitlist =
  | { ok: true; request: WaitlistRequest }
  | { ok: false; problems: Partial<Record<WaitlistField, string>>; values: WaitlistValues }

const MAX_TEAM = 120
const MAX_NOTE = 1000

/** Checks the team details someone the beta refused sends from the invite-only page. */
export function parseWaitlistForm(form: FormData): ParsedWaitlist {
  const text = (name: WaitlistField) => {
    const value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }
  const values: WaitlistValues = { email: text('email'), team: text('team'), size: text('size'), note: text('note') }
  const problems: Partial<Record<WaitlistField, string>> = {}

  const email = normaliseEmail(values.email)
  if (!email) problems.email = 'Enter an email we can reach you at.'
  if (!values.team) problems.team = 'Tell us what your team is called.'
  else if (values.team.length > MAX_TEAM) problems.team = `Keep the team name to ${MAX_TEAM} characters.`
  const teamSize: TeamSize | null = values.size === '' ? null : isTeamSize(values.size) ? values.size : null
  if (values.size !== '' && teamSize === null) problems.size = 'Pick one of the team sizes.'
  if (values.note.length > MAX_NOTE) problems.note = `Keep it to ${MAX_NOTE} characters.`

  if (!email || Object.keys(problems).length) return { ok: false, problems, values }
  return { ok: true, request: { email, teamName: values.team, teamSize, note: values.note || null } }
}
