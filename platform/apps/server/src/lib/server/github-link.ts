// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import { authorizeUrl, exchangeCode, fetchIdentity, newAuthorization } from '@docket/platform-auth'
import { ConnectionError, linkInstallation } from '@docket/platform-github'
import { ACCOUNT, accessOf, can, membershipBySlug, type Tx } from '@docket/platform-tenancy'
import { error, isHttpError, isRedirect, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit'

import { auditInput, requireUser } from './request'
import { getRuntime } from './runtime'
import { OAUTH_COOKIE, safeNext } from './signin'

/**
 * Linking a GitHub App installation to an org (§14.1). GitHub sends the
 * installer back to the setup URL with an `installation_id` anyone could
 * type, so the id alone proves nothing. Docket Cloud first checks the `state`
 * it gave the admin who clicked "Install", then asks GitHub, through a fresh
 * user authorization of that same GitHub account, whether the account can see
 * the installation. Only then is it linked.
 */

/** Carries the install's `state`, org and workspace from "Install" to the setup URL. */
export const INSTALL_COOKIE = 'docket_gh_install'

export interface PendingLink {
  installationId: number
  org: string
  next: string
}

/** Sends an admin to install the app; GitHub returns them to `/github/setup` with the same `state`. */
export function startInstall(event: RequestEvent, input: { org: string; ws: string }): never {
  const { githubApp, secureCookies } = getRuntime()
  if (!githubApp) error(503, 'Repo sync is not configured.')
  const { state } = newAuthorization()
  event.cookies.set(INSTALL_COOKIE, JSON.stringify({ state, org: input.org, ws: input.ws }), {
    path: '/github',
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    maxAge: 1800,
  })
  redirect(303, githubApp.installUrl(state))
}

function readInstallCookie(cookies: Cookies): { state?: unknown; org?: unknown; ws?: unknown } {
  const raw = cookies.get(INSTALL_COOKIE)
  cookies.delete(INSTALL_COOKIE, { path: '/github' })
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const reposPage = (org: string, ws: string) => `/a/${encodeURIComponent(org)}/d/${encodeURIComponent(ws)}/repos`

/** The member at `slug`, and whether they may link a GitHub installation to it: Change settings on the whole account. */
async function linker(tx: Tx, slug: string, userId: string) {
  const member = await membershipBySlug(tx, slug, userId)
  if (!member) return null
  return { org: member.org, mayLink: can(await accessOf(tx, member.org.id, userId), 'settings', ACCOUNT) }
}

/**
 * GitHub's setup redirect after an install. Checks the `state` cookie, then
 * starts a user authorization whose callback finishes the link.
 */
export async function setupRedirect(event: RequestEvent): Promise<never> {
  const user = requireUser(event)
  const { github, secureCookies } = getRuntime()
  const started = readInstallCookie(event.cookies)
  const state = event.url.searchParams.get('state')
  const installationId = Number(event.url.searchParams.get('installation_id'))
  if (typeof started.org !== 'string' || typeof started.ws !== 'string' || typeof started.state !== 'string') {
    // Installed from GitHub, not from a Repos page: nothing says which org it is for.
    redirect(303, '/?github=installed-elsewhere')
  }
  const back = reposPage(started.org, started.ws)
  if (started.state !== state || !Number.isSafeInteger(installationId) || installationId <= 0) {
    redirect(303, `${back}?link=expired`)
  }
  if (!github) redirect(303, `${back}?link=unconfigured`)
  const member = await getRuntime().router.withPlatform((tx) => linker(tx, started.org as string, user.id))
  if (!member) error(404, 'Not found')
  if (!member.mayLink) error(403, 'You do not have access to that.')

  const authorization = newAuthorization()
  const pending: PendingLink = { installationId, org: started.org, next: back }
  event.cookies.set(
    OAUTH_COOKIE,
    JSON.stringify({ state: authorization.state, verifier: authorization.verifier, next: back, link: pending }),
    { path: '/auth/github', httpOnly: true, secure: secureCookies, sameSite: 'lax', maxAge: 600 },
  )
  redirect(302, authorizeUrl(github, authorization))
}

/** Reads the link a sign-in callback carries, if any. */
export function pendingLinkOf(started: { link?: unknown }): PendingLink | null {
  const link = started.link as Partial<PendingLink> | undefined
  if (!link || typeof link !== 'object') return null
  if (!Number.isSafeInteger(link.installationId) || typeof link.org !== 'string') return null
  return { installationId: link.installationId as number, org: link.org, next: safeNext(link.next ?? '/') }
}

/**
 * Finishes a link in the sign-in callback: the code is exchanged for a user
 * token of the same GitHub account as the session, which must be able to see
 * the installation. The token is used for that one call and never stored.
 */
export async function completeLink(event: RequestEvent, link: PendingLink, code: string, verifier: string): Promise<never> {
  const user = event.locals.user
  if (!user) redirect(303, `/signin?next=${encodeURIComponent(link.next)}`)
  const { github, githubApp, router } = getRuntime()
  if (!github || !githubApp) redirect(303, `${link.next}?link=unconfigured`)

  let outcome: 'linked' | 'not-yours' | 'other-account' | 'github' | 'taken' = 'github'
  let account = ''
  try {
    const token = await exchangeCode(github, { code, verifier })
    const identity = await fetchIdentity(github, token)
    const sameAccount = await router.withPlatform(async (tx) => {
      const { rows } = await tx.query<{ github_id: string | null }>('SELECT github_id FROM platform.users WHERE id = $1', [user.id])
      return rows[0]?.github_id !== undefined && Number(rows[0]?.github_id) === identity.id
    })
    if (!sameAccount) outcome = 'other-account'
    else if (!(await githubApp.userInstallations(token)).includes(link.installationId)) outcome = 'not-yours'
    else {
      const installation = await githubApp.installation(link.installationId)
      account = installation.account.login
      outcome = await router.withPlatform(async (tx) => {
        const member = await linker(tx, link.org, user.id)
        if (!member?.mayLink) error(404, 'Not found')
        try {
          await linkInstallation(tx, {
            installationId: installation.id,
            orgId: member.org.id,
            accountLogin: installation.account.login,
            accountType: installation.account.type,
            linkedBy: user.id,
          })
        } catch (caught) {
          if (caught instanceof ConnectionError) return 'taken' as const
          throw caught
        }
        await router.enterTenant(tx, member.org.id)
        await audit(tx, auditInput(event, { action: 'github.installation.link', outcome: 'ok', orgId: member.org.id, target: [`installation:${installation.id}`, `github:${account}`] }))
        event.locals.audited = true
        return 'linked' as const
      })
    }
  } catch (caught) {
    if (isHttpError(caught) || isRedirect(caught)) throw caught
    console.error(`[${event.locals.requestId}] linking a GitHub installation: ${caught instanceof Error ? caught.message : String(caught)}`)
    outcome = 'github'
  }
  const query = new URLSearchParams({ link: outcome, ...(account ? { account } : {}) })
  redirect(303, `${link.next}?${query}`)
}
