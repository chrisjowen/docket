// SPDX-License-Identifier: AGPL-3.0-only
import { audit } from '@docket/platform-audit'
import { TenancyError } from '@docket/platform-tenancy'
import { fail, type RequestEvent } from '@sveltejs/kit'

import { changeAccount, operatorOverview, type AccountChange } from '$lib/server/operator'
import { auditInput, requirePlatformAdmin } from '$lib/server/request'

import type { Actions, PageServerLoad } from './$types'

/**
 * The operator console (tenancy v2 §3.5, phase 6.3): every account on the
 * platform, for its operators alone (`DOCKET_PLATFORM_ADMINS`; anyone else
 * gets 404). Suspend or resume one, and set its own limits on seats and
 * dockets. It shows who owns each account and how many people, system
 * accounts and invites it has - never anything of its content.
 */
export const load: PageServerLoad = async (event) => {
  requirePlatformAdmin(event)
  const { accounts, defaults, platform } = await operatorOverview()
  return {
    defaults,
    platform,
    accounts: accounts.map((account) => ({
      id: account.id,
      slug: account.slug,
      name: account.name,
      status: account.status,
      createdAt: account.createdAt.toISOString(),
      owners: account.owners,
      people: account.people,
      systemAccounts: account.systemAccounts,
      openInvites: account.openInvites,
      limits: account.limits,
      suspended: account.suspended ? { at: account.suspended.at.toISOString(), by: account.suspended.by, reason: account.suspended.reason } : null,
    })),
  }
}

/** A limit from the form: blank is the beta's (null); anything else must be a whole number. */
function limitFrom(form: FormData, field: string): number | null {
  const raw = String(form.get(field) ?? '').trim()
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new TenancyError('invalid', 'A limit is a whole number, or blank for the beta’s.')
  return value
}

async function change(event: RequestEvent, of: (form: FormData) => AccountChange, flash: (name: string) => string) {
  const operator = requirePlatformAdmin(event)
  const form = await event.request.formData()
  const slug = String(form.get('account') ?? '')
  try {
    const changed = await changeAccount(slug, of(form), operator.id, async (tx, entry) => {
      await audit(tx, auditInput(event, { action: entry.action, outcome: 'ok', orgId: null, target: entry.target, args: entry.args }))
      event.locals.audited = true
    })
    return { flash: flash(changed.name), account: changed.slug }
  } catch (cause) {
    if (cause instanceof TenancyError) return fail(cause.code === 'not-found' ? 404 : 400, { problem: cause.message, account: slug })
    throw cause
  }
}

export const actions: Actions = {
  suspend: (event) =>
    change(
      event,
      (form) => ({ suspended: true, reason: String(form.get('reason') ?? '').trim() || null }),
      (name) => `Suspended ${name}. Nothing in it is served until you resume it; nothing in it is lost.`,
    ),
  resume: (event) => change(event, () => ({ suspended: false }), (name) => `Resumed ${name}.`),
  limits: (event) =>
    change(
      event,
      (form) => ({ maxMembers: limitFrom(form, 'max_members'), maxDockets: limitFrom(form, 'max_dockets') }),
      (name) => `Set ${name}'s limits.`,
    ),
}
