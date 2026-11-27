// SPDX-License-Identifier: AGPL-3.0-only
import {
  TrustError,
  attestationsChanged,
  listPeople,
  listRegistry,
  type ListedProposal,
  type ProposalWriteResult,
  type RegisteredSource,
  type StoreContext,
} from '@docket/platform-canonical-store'
import { listMembers, type Member } from '@docket/platform-tenancy'
import { error, json, type RequestEvent } from '@sveltejs/kit'

import { recordAudit, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/**
 * What the org attests about sources, over JSON (trust design §3.2): the
 * people directory, by member; and the source registry. Everyone in the org
 * reads them; owners and admins change them (`trust.manage`), and every
 * change scores the org's workspaces again - its pending proposals too.
 */

/** A member as the people directory API shows them. */
export interface DirectoryEntry {
  login: string
  name: string | null
  role: Member['role']
  attributes: Record<string, unknown>
  updatedAt: string | null
}

/** Every human member of the org, with what the directory attests about them. */
export async function directory(access: OrgAccess, ctx: StoreContext): Promise<DirectoryEntry[]> {
  const members = await getRuntime().router.withPlatform((tx) => listMembers(tx, access.org.id))
  const attested = new Map((await listPeople(ctx)).map((person) => [person.userId, person]))
  return members
    .filter((member) => member.kind === 'human')
    .map((member) => ({
      login: member.login,
      name: member.name,
      role: member.role,
      attributes: attested.get(member.id)?.attributes ?? {},
      updatedAt: attested.get(member.id)?.updatedAt.toISOString() ?? null,
    }))
}

/** A member of the org by login, or 404. */
export async function memberByLogin(access: OrgAccess, login: string): Promise<Member> {
  const members = await getRuntime().router.withPlatform((tx) => listMembers(tx, access.org.id))
  const member = members.find((each) => each.kind === 'human' && each.login.toLowerCase() === login.trim().replace(/^@/, '').toLowerCase())
  if (!member) error(404, 'No such member.')
  return member
}

export const registered = (entry: RegisteredSource) => ({
  source: entry.source,
  instance: entry.instance,
  attributes: entry.attributes,
  updatedBy: entry.updatedBy,
  updatedAt: entry.updatedAt.toISOString(),
})

export async function registry(ctx: StoreContext, source: string | null) {
  return (await listRegistry(ctx, source ?? undefined)).map(registered)
}

/** A JSON body as an object, or 400. */
export async function bodyOf(event: RequestEvent): Promise<Record<string, unknown>> {
  const body = (await event.request.json().catch(() => null)) as unknown
  if (typeof body !== 'object' || body === null || Array.isArray(body)) error(400, 'Send a JSON object.')
  return body as Record<string, unknown>
}

/**
 * Applies a change to what the org attests, audits it in the same
 * transaction, then scores every workspace again. A `TrustError` is a 400
 * (or a 404 for something not registered).
 */
export async function attest<T>(
  event: RequestEvent,
  access: OrgAccess,
  ctx: StoreContext,
  change: () => Promise<{ value: T; action: string; target: string[]; args?: unknown }>,
): Promise<T> {
  try {
    const done = await change()
    const promoted = await attestationsChanged(ctx)
    await recordAudit(ctx.tx, event, {
      action: done.action,
      orgId: access.org.id,
      target: done.target,
      args: { ...(done.args as object | undefined), ...(promoted.length ? { accepted: promoted.map((each) => each.id) } : {}) },
    })
    return done.value
  } catch (caught) {
    if (caught instanceof TrustError) error(caught.code === 'not-found' ? 404 : 400, caught.message)
    throw caught
  }
}

/** A supersede proposal as the API and the Proposals queue show it. */
export function proposalView(listed: Pick<ListedProposal, 'supersession' | 'score' | 'threshold' | 'stale' | 'carry'>) {
  const { supersession: each } = listed
  return {
    id: each.id,
    resource: each.resourceId,
    by: each.supersededBy,
    reason: each.reason,
    status: each.status,
    score: listed.score,
    threshold: listed.threshold,
    stale: listed.stale,
    carry: listed.carry,
    source: each.source,
    recordedBy: each.actorLabel,
    recordedAt: each.recordedAt.toISOString(),
    validUntil: each.validUntil.toISOString(),
    decidedAt: each.decidedAt?.toISOString() ?? null,
    decidedBy: each.decidedBy,
    grandfathered: each.grandfathered,
    ...(each.rejection !== undefined ? { rejection: each.rejection } : {}),
    ...(each.override !== undefined ? { override: each.override } : {}),
    evidence: each.evidence,
  }
}

/** A proposal decision's answer: 200 with the proposal as it stands, or 400 with the refusal. */
export function decisionAnswer(result: ProposalWriteResult) {
  const errors = result.diagnostics.filter((d) => d.severity === 'error')
  const diagnostics = result.diagnostics.map(({ severity, code, message }) => ({ severity, code, message }))
  if (errors.length) return json({ ok: false, diagnostics }, { status: errors.some((d) => d.code === 'unknown-proposal') ? 404 : 400 })
  return json({ ok: true, changed: result.changed, proposal: result.proposal ?? null, diagnostics })
}
