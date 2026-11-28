// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signing up (tenancy v2 §6), in seven steps:
 *
 * 1. Sign in with GitHub. An open invite skips you ahead, into its account.
 * 2. Create your account (`/start`). You become its Owner; the page says
 *    what the account gets: Postgres, Neo4j, Qdrant and the AI cap.
 * 3. Your first space, General (`/a/{acct}/start/space`): what everyone
 *    gets there (Reader by default), and optionally more spaces.
 * 4. Your first docket: the same New docket page, from General's +.
 * 5. Connect an AI client (`/a/{acct}/start/connect`), one of three ways.
 * 6. Invite users (`/a/{acct}/start/invite`): one row each, login or
 *    email, role and place.
 * 7. Done: you land in the docket's Chat tab.
 *
 * Later invites come from Users › Invite.
 */
export const ONBOARDING_STEPS = [
  { key: 'signin', label: 'Sign in' },
  { key: 'account', label: 'Your account' },
  { key: 'space', label: 'Spaces' },
  { key: 'docket', label: 'First docket' },
  { key: 'connect', label: 'Connect AI' },
  { key: 'invite', label: 'Invite' },
  { key: 'done', label: 'Done' },
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]['key']

/** A step's number, 1 to 7. */
export const stepNumber = (key: OnboardingStep): number => ONBOARDING_STEPS.findIndex((step) => step.key === key) + 1

/** The query New docket carries while it is step 4, so that making the docket goes on to step 5. */
export const ONBOARDING_PARAM = 'start'

/** Where step 4 goes on to, once the docket is made. */
export const afterFirstDocket = (acct: string, docket: string) => `/a/${acct}/start/connect?docket=${encodeURIComponent(docket)}`

/** Step 7: the new docket's Chat tab. */
export const onboardingDone = (acct: string, docket: string | null) => (docket ? `/a/${acct}/d/${docket}/ask` : `/a/${acct}`)
