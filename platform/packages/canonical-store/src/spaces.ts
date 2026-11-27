// SPDX-License-Identifier: AGPL-3.0-only
import { newTenantId, type Tx } from '@docket/platform-tenancy'

import { WorkspaceError, workspaceSlugProblem } from './workspaces.js'

/**
 * Spaces (tenancy v2 §2, org 0020): a space groups an org's dockets for a
 * team, department or client, and a role on a space covers every docket in
 * it. Every org starts with General. Every function runs inside the org's
 * `withTenant` transaction.
 */
export interface Space {
  id: string
  slug: string
  name: string
  description: string | null
  /** The space every account starts with; it cannot be removed. */
  general: boolean
  createdBy: string
  createdAt: Date
}

type SpaceRow = { id: string; slug: string; name: string; description: string | null; general: boolean; created_by: string; created_at: Date }

const toSpace = (row: SpaceRow): Space => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  general: row.general,
  createdBy: row.created_by,
  createdAt: row.created_at,
})

/** The org's spaces: General first, then by name. */
export async function listSpaces(tx: Tx): Promise<Space[]> {
  const { rows } = await tx.query<SpaceRow>('SELECT * FROM spaces ORDER BY general DESC, lower(name), slug')
  return rows.map(toSpace)
}

export async function spaceBySlug(tx: Tx, slug: string): Promise<Space | null> {
  const { rows } = await tx.query<SpaceRow>('SELECT * FROM spaces WHERE slug = $1', [slug])
  return rows[0] ? toSpace(rows[0]) : null
}

export async function spaceById(tx: Tx, id: string): Promise<Space | null> {
  const { rows } = await tx.query<SpaceRow>('SELECT * FROM spaces WHERE id = $1', [id])
  return rows[0] ? toSpace(rows[0]) : null
}

/** A space's address inside its org (`/o/{org}/s/{slug}`): a docket address's shape, with `new` kept for the create page. */
export function spaceSlugProblem(slug: string): string | null {
  return workspaceSlugProblem(slug)
}

/** The name and address a new space would take, checked; null when they are fine. */
export async function newSpaceProblem(tx: Tx, input: { name: string; slug: string }): Promise<string | null> {
  const name = input.name.trim()
  if (!name || name.length > 80) return 'Name the space in 1-80 characters.'
  const problem = spaceSlugProblem(input.slug)
  if (problem) return problem
  if (await spaceBySlug(tx, input.slug)) return 'A space already has that address.'
  return null
}

/** Makes a space. Who may is the caller's to check (`mayCreateSpace`). */
export async function insertSpace(tx: Tx, input: { name: string; slug: string; description?: string | null; createdBy: string }): Promise<Space> {
  const problem = await newSpaceProblem(tx, input)
  if (problem) throw new WorkspaceError(problem.includes('already') ? 'conflict' : 'invalid', problem)
  const description = input.description?.trim().slice(0, 300) || null
  try {
    const { rows } = await tx.query<SpaceRow>(
      'INSERT INTO spaces (id, slug, name, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [newTenantId(), input.slug, input.name.trim(), description, input.createdBy],
    )
    return toSpace(rows[0] as SpaceRow)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new WorkspaceError('conflict', 'A space already has that address.')
    throw error
  }
}
