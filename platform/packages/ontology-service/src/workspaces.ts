// SPDX-License-Identifier: AGPL-3.0-only
import { insertWorkspace, workspaceById, type StoreContext, type Workspace } from '@docket/platform-canonical-store'

import { VersionNotFound } from './errors.js'
import { orgTemplateById } from './org-templates.js'
import { template, type TemplateId } from './templates.js'
import { createDraft, headOf, publish, type Published, type Publisher } from './versions.js'

/**
 * Where a new workspace's ontology comes from (§13.3): a built-in template,
 * one of the org's own, an imported file, another workspace's, or a draft
 * reviewed before the workspace existed (`docket-drafts.ts`).
 */
export type OntologyStart =
  | { template: TemplateId }
  | { orgTemplate: string }
  | { importYaml: string }
  | { copyFrom: string }
  | { drafted: { yaml: string; source: string; message?: string | null } }

/**
 * Creates a workspace and publishes its first ontology version, in the
 * caller's transaction. The ontology goes through the same draft and checks
 * as any other (§13.4); with no documents yet, they pass.
 */
export async function createWorkspace(
  ctx: StoreContext,
  input: { name: string; slug: string; start: OntologyStart; publisher: Publisher; requestId?: string; maxWorkspaces?: number },
): Promise<{ workspace: Workspace; version: Published }> {
  let yaml: string
  let source: string
  let message: string
  if ('template' in input.start) {
    yaml = template(input.start.template).yaml
    source = `template:${input.start.template}`
    message = `Started from the ${input.start.template} template`
  } else if ('orgTemplate' in input.start) {
    const found = await orgTemplateById(ctx.tx, input.start.orgTemplate)
    if (!found) throw new VersionNotFound('That template no longer exists.')
    yaml = found.yaml
    source = `org-template:${found.id}`
    message = `Started from the ${found.name} template`
  } else if ('importYaml' in input.start) {
    yaml = input.start.importYaml
    source = 'import'
    message = 'Imported'
  } else if ('drafted' in input.start) {
    yaml = input.start.drafted.yaml
    source = input.start.drafted.source
    message = input.start.drafted.message || 'Drafted before the docket was made'
  } else {
    const from = await workspaceById(ctx.tx, input.start.copyFrom)
    const head = from ? await headOf(ctx.tx, from.id) : null
    if (!from || !head) throw new VersionNotFound('That workspace has no published ontology to copy.')
    yaml = head.yaml
    source = `copy:${from.slug}`
    message = `Copied from ${from.slug}`
  }
  const workspace = await insertWorkspace(ctx.tx, {
    name: input.name,
    slug: input.slug,
    createdBy: input.publisher.actor,
    ...(input.maxWorkspaces !== undefined ? { maxWorkspaces: input.maxWorkspaces } : {}),
  })
  const draft = await createDraft(ctx.tx, workspace.id, { yaml, source, author: input.publisher.actor })
  const version = await publish(ctx, workspace.id, draft.id, {
    expectedHead: 0,
    publisher: input.publisher,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    message,
  })
  return { workspace, version }
}
