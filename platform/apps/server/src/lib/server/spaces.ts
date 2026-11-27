// SPDX-License-Identifier: AGPL-3.0-only
import { listSpaces, spaceBySlug, type Space } from '@docket/platform-canonical-store'
import { CAPABILITIES, GENERAL_SPACE_ID, seesSpace, spacePlace, type Capability } from '@docket/platform-tenancy'
import { error, type RequestEvent } from '@sveltejs/kit'

import { orgAccess, type OrgAccess } from './request'
import { getRuntime } from './runtime'

/** A space as its pages show it. */
export const spaceView = (space: Space) => ({ id: space.id, slug: space.slug, name: space.name, description: space.description, general: space.general })

export interface SpaceAccess {
  access: OrgAccess
  space: Space
  /** What the member may do on the space: every grant that covers it (the account's and the space's own). */
  caps: ReadonlySet<Capability>
}

/**
 * The space named in the URL path and what the member may do on it. A space
 * the org does not have answers 404, and so does one the member may not see
 * (a guest's, holding nothing in it), as for dockets (§5.5).
 */
export async function spaceAccess(event: RequestEvent, options: { api?: boolean } = {}): Promise<SpaceAccess> {
  const access = await orgAccess(event, options)
  const space = await getRuntime().router.withTenant(access.org.id, (tx) => spaceBySlug(tx, event.params.space ?? ''))
  if (!space || !seesSpace(access.principal, space.id)) error(404, 'Not found')
  return { access, space, caps: access.capsAt(spacePlace(space.id)) }
}

/** The capabilities a member holds on a space, one flag each, for a page. */
export const capFlags = (caps: ReadonlySet<Capability>) =>
  Object.fromEntries(CAPABILITIES.map((cap) => [cap, caps.has(cap)])) as Record<Capability, boolean>

/**
 * Where "New docket" without a space goes: General when the member may add a
 * docket there, otherwise the first space where they may. Null when nowhere.
 */
export async function spaceToCreateIn(access: OrgAccess): Promise<Space | null> {
  const spaces = await getRuntime().router.withTenant(access.org.id, listSpaces)
  const creates = (space: Space) => access.capsAt(spacePlace(space.id)).has('create')
  return spaces.find((space) => space.id === GENERAL_SPACE_ID && creates(space)) ?? spaces.find(creates) ?? null
}
