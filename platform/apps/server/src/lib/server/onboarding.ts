// SPDX-License-Identifier: AGPL-3.0-only
import { isAccountAdmin } from '@docket/platform-tenancy'
import { error, type RequestEvent } from '@sveltejs/kit'

import { ONBOARDING_PARAM } from '$lib/onboarding'

import { orgAccess, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/**
 * The account being set up (tenancy v2 §6, steps 3 to 6): whoever made it
 * is its Owner, and setting it up takes an Admin on the whole account, who
 * may make spaces and give access anywhere in it. Anyone else is refused.
 */
export async function settingUp(event: RequestEvent): Promise<OrgAccess> {
  const access = await orgAccess(event)
  if (!isAccountAdmin(access.principal)) error(403, 'Only an admin of the whole account sets it up.')
  return access
}

/** The docket step 4 made, as the later steps carry it (`?docket=`): a slug, or null. */
export function firstDocketOf(url: URL): string | null {
  const slug = url.searchParams.get('docket')
  return slug && /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) ? slug : null
}

/** Whether New docket is step 4 of signing up: opened, and posted, with `?start=1`. */
export const onboarding = (event: Pick<RequestEvent, 'url'>): boolean => event.url.searchParams.get(ONBOARDING_PARAM) === '1'

/**
 * The cookie that says a docket draft was described during signing up, so
 * that making the docket from it goes on to step 5. It is sent only to that
 * draft's own page, and lasts a day.
 */
const ONBOARDING_DRAFT_COOKIE = 'docket_onboarding_draft'

export function rememberOnboardingDraft(event: Pick<RequestEvent, 'cookies'>, acct: string, draftId: string): void {
  event.cookies.set(ONBOARDING_DRAFT_COOKIE, draftId, {
    path: `/a/${acct}/dockets/new/draft/${draftId}`,
    httpOnly: true,
    sameSite: 'lax',
    secure: getRuntime().secureCookies,
    maxAge: 60 * 60 * 24,
  })
}

/** Whether this draft was described during signing up. */
export const onboardingDraft = (event: Pick<RequestEvent, 'cookies' | 'params'>): boolean =>
  Boolean(event.params.id) && event.cookies.get(ONBOARDING_DRAFT_COOKIE) === event.params.id

/** Forgets that a draft was described during signing up, once its docket is made. */
export function forgetOnboardingDraft(event: Pick<RequestEvent, 'cookies' | 'params' | 'url'>): void {
  event.cookies.delete(ONBOARDING_DRAFT_COOKIE, { path: event.url.pathname.replace(/\/$/, '') })
}
