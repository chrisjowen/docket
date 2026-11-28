// SPDX-License-Identifier: AGPL-3.0-only
import { hashContent } from '@docket/platform-canonical-store'
import type { Tx } from '@docket/platform-tenancy'

import { contentsOf, normaliseTags, type CatalogueEntry } from './catalogue.js'
import { parseDraft } from './check.js'
import { VersionNotFound } from './errors.js'
import { headOf } from './versions.js'
import { importYaml } from './yaml-io.js'

/**
 * The org's own ontology templates: a docket's published ontology, never its
 * documents, saved by an owner or admin under a name for New docket to offer
 * beside the built-in ones. They live in the org's schema, so no other org
 * reads them. The built-in templates are not here and cannot be changed.
 */
export interface OrgTemplate {
  id: string
  name: string
  description: string
  tags: string[]
  yaml: string
  yamlHash: string
  /** The docket it was saved or last updated from; null when that docket has gone. */
  fromWorkspaceId: string | null
  createdBy: string
  updatedBy: string
  createdAt: Date
  updatedAt: Date
}

/** A template name, description or tag list that will not do, or a name another template has. */
export class TemplateError extends Error {
  override name = 'TemplateError'
  constructor(
    readonly code: 'invalid' | 'conflict' | 'not-found',
    message: string,
  ) {
    super(message)
  }
}

type TemplateRow = {
  id: string
  name: string
  description: string
  tags: string[]
  yaml: string
  yaml_hash: string
  from_workspace_id: string | null
  created_by: string
  updated_by: string
  created_at: Date
  updated_at: Date
}

const toTemplate = (row: TemplateRow): OrgTemplate => ({
  id: row.id,
  name: row.name,
  description: row.description,
  tags: row.tags,
  yaml: row.yaml,
  yamlHash: row.yaml_hash,
  fromWorkspaceId: row.from_workspace_id,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The most templates an org keeps. */
export const MAX_ORG_TEMPLATES = 50

/** A catalogue card's id for one of the org's templates. */
export const orgTemplateKey = (id: string) => `org:${id}`

/** The org template a catalogue card's id names, or null for a built-in one. */
export function orgTemplateId(key: string): string | null {
  const id = key.startsWith('org:') ? key.slice(4) : null
  return id && UUID.test(id) ? id : null
}

/** The org's template as a catalogue card. */
export function orgCatalogueEntry(template: OrgTemplate): CatalogueEntry {
  return {
    id: orgTemplateKey(template.id),
    kind: 'org',
    name: template.name,
    description: template.description,
    tags: template.tags,
    ...contentsOf(template.yaml),
  }
}

function checked(input: { name?: string; description?: string; tags?: string | readonly string[] }) {
  const name = input.name?.trim()
  if (name !== undefined && (!name || name.length > 80)) throw new TemplateError('invalid', 'Name the template in 1-80 characters.')
  const description = input.description?.trim()
  if (description !== undefined && description.length > 500) throw new TemplateError('invalid', 'Describe the template in at most 500 characters.')
  return { name, description, tags: input.tags === undefined ? undefined : normaliseTags(input.tags) }
}

/** The text as a template keeps it: docket's loader reads it, and it must be an ontology. */
function ontologyText(yaml: string): string {
  const text = importYaml(yaml).yaml
  parseDraft(text)
  return text
}

/** Renames a unique-name clash as the error the page shows. */
async function unique<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (caught) {
    if ((caught as { code?: string }).code === '23505') throw new TemplateError('conflict', 'Another template has that name.')
    throw caught
  }
}

export async function listOrgTemplates(tx: Tx): Promise<OrgTemplate[]> {
  const { rows } = await tx.query<TemplateRow>('SELECT * FROM ontology_templates ORDER BY lower(name)')
  return rows.map(toTemplate)
}

export async function orgTemplateById(tx: Tx, id: string): Promise<OrgTemplate | null> {
  if (!UUID.test(id)) return null
  const { rows } = await tx.query<TemplateRow>('SELECT * FROM ontology_templates WHERE id = $1', [id])
  return rows[0] ? toTemplate(rows[0]) : null
}

/** A docket's published ontology, which a template is saved from. */
async function publishedText(tx: Tx, workspaceId: string): Promise<string> {
  const head = await headOf(tx, workspaceId)
  if (!head) throw new VersionNotFound('That docket has no published ontology to save.')
  return head.yaml
}

/** Saves a docket's published ontology, and nothing else of it, as a new org template. */
export async function saveOrgTemplate(
  tx: Tx,
  input: { name: string; description?: string; tags?: string | readonly string[]; fromWorkspaceId: string; actor: string },
): Promise<OrgTemplate> {
  const { name, description, tags } = checked(input)
  const yaml = ontologyText(await publishedText(tx, input.fromWorkspaceId))
  // Serialised per org, so the limit holds under concurrent saves.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('docket-cloud:template-save:' || current_schema()))")
  const { rows: counted } = await tx.query<{ count: string }>('SELECT count(*) FROM ontology_templates')
  if (Number(counted[0]?.count ?? 0) >= MAX_ORG_TEMPLATES) throw new TemplateError('invalid', `An account keeps at most ${MAX_ORG_TEMPLATES} templates.`)
  const { rows } = await unique(() =>
    tx.query<TemplateRow>(
      `INSERT INTO ontology_templates (name, description, tags, yaml, yaml_hash, from_workspace_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [name, description ?? '', tags ?? [], yaml, hashContent(yaml), input.fromWorkspaceId, input.actor],
    ),
  )
  return toTemplate(rows[0] as TemplateRow)
}

/**
 * Changes a template's name, description or tags, or replaces its ontology
 * with a docket's published one (`fromWorkspaceId`). Dockets already started
 * from it keep the ontology they started with.
 */
export async function updateOrgTemplate(
  tx: Tx,
  id: string,
  input: { name?: string; description?: string; tags?: string | readonly string[]; fromWorkspaceId?: string; actor: string },
): Promise<OrgTemplate> {
  const existing = await orgTemplateById(tx, id)
  if (!existing) throw new TemplateError('not-found', 'No such template.')
  const { name, description, tags } = checked(input)
  const yaml = input.fromWorkspaceId ? ontologyText(await publishedText(tx, input.fromWorkspaceId)) : existing.yaml
  const { rows } = await unique(() =>
    tx.query<TemplateRow>(
      `UPDATE ontology_templates
          SET name = $2, description = $3, tags = $4, yaml = $5, yaml_hash = $6, from_workspace_id = $7, updated_by = $8, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [
        id,
        name ?? existing.name,
        description ?? existing.description,
        tags ?? existing.tags,
        yaml,
        hashContent(yaml),
        input.fromWorkspaceId ?? existing.fromWorkspaceId,
        input.actor,
      ],
    ),
  )
  return toTemplate(rows[0] as TemplateRow)
}

/** Deletes a template. Dockets started from it keep their ontology. */
export async function deleteOrgTemplate(tx: Tx, id: string): Promise<OrgTemplate> {
  if (!UUID.test(id)) throw new TemplateError('not-found', 'No such template.')
  const { rows } = await tx.query<TemplateRow>('DELETE FROM ontology_templates WHERE id = $1 RETURNING *', [id])
  if (!rows[0]) throw new TemplateError('not-found', 'No such template.')
  return toTemplate(rows[0])
}
