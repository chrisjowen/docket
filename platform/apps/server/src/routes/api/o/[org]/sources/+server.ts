// SPDX-License-Identifier: AGPL-3.0-only
import { registerSource, unregisterSource } from '@docket/platform-canonical-store'
import { error, json } from '@sveltejs/kit'

import { authorise, orgAccess, requireUser } from '$lib/server/request'
import { attest, bodyOf, registered, registry } from '$lib/server/trust'
import { inOrg } from '$lib/server/workspace'

import type { RequestHandler } from './$types'

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) error(400, `Give ${name}.`)
  return value
}

/**
 * The source registry: source instances the org has registered, such as a
 * document by its URL, with what it attests about each - a status, an owner.
 * `?source=document` lists one source type's. Any member reads it.
 */
export const GET: RequestHandler = async (event) => {
  const access = await orgAccess(event, { api: true })
  authorise(access, 'graph.read')
  return json({ org: access.org.slug, sources: await inOrg(access, (ctx) => registry(ctx, event.url.searchParams.get('source'))) })
}

/**
 * Registers a source instance, or replaces what the registry says about it:
 * `{ "source": "document", "instance": "notion://payments-architecture", "attributes": { "status": "verified" } }`.
 * Owners and admins only; every workspace is scored again.
 */
export const PUT: RequestHandler = async (event) => {
  const user = requireUser(event)
  const access = await orgAccess(event, { api: true })
  authorise(access, 'trust.manage')
  const body = await bodyOf(event)
  const source = text(body.source, 'the source type')
  const instance = text(body.instance, 'the instance')
  const entry = await inOrg(access, (ctx) =>
    attest(event, access, ctx, async () => ({
      value: await registerSource(ctx, { source, instance, attributes: body.attributes ?? {}, actor: `user:${user.id}` }),
      action: 'trust.source.register',
      target: [`source:${source}:${instance}`.slice(0, 200)],
      args: { attributes: body.attributes ?? {} },
    })),
  )
  return json(registered(entry))
}

/** Unregisters a source instance: `?source=document&instance=…`. Owners and admins only. */
export const DELETE: RequestHandler = async (event) => {
  const access = await orgAccess(event, { api: true })
  authorise(access, 'trust.manage')
  const source = text(event.url.searchParams.get('source'), 'the source type')
  const instance = text(event.url.searchParams.get('instance'), 'the instance')
  await inOrg(access, (ctx) =>
    attest(event, access, ctx, async () => ({
      value: await unregisterSource(ctx, { source, instance }),
      action: 'trust.source.unregister',
      target: [`source:${source}:${instance}`.slice(0, 200)],
    })),
  )
  return new Response(null, { status: 204 })
}
