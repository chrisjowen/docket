// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { filesystemSource, memoryConfigSchema } from '@chrisjowen/docket'
import { audit, type AuditEventInput } from '@docket/platform-audit'
import {
  CLOUD_ONTOLOGY_PATH,
  DocumentError,
  checkDocument,
  postgresSource,
  putDocument,
  validate,
  workspaceBySlug,
  type Diagnostic,
  type Keyring,
  type StoreContext,
} from '@docket/platform-canonical-store'
import {
  OntologyBreakingChange,
  OntologyNarrowingChange,
  createDraft,
  headOf,
  importYaml,
  parseDraft,
  publish,
  type Publisher,
} from '@docket/platform-ontology-service'
import type { TenantRouter } from '@docket/platform-tenancy'

/**
 * The operator's one-off import of a repo's docket tree into an existing
 * workspace, until repo sync (M7) and the CLI (M8) exist. It writes through
 * the same paths as the ontology editor and the documents page: the ontology
 * is drafted and published with its change check, every document is written
 * as a revision and validated with docket's validator, the outbox queues the
 * worker, and the audit log records the operator. It never creates an org or
 * a workspace.
 */

/** A docket tree as it is imported: the ontology's text and every document, at its path under `.docket/`. */
export interface DocketTree {
  ontology: string
  /** Posix paths starting `.docket/`, sorted. */
  documents: { path: string; raw: string }[]
}

/** Who imports: the audit actor and the login the ontology's migration evidence would name. */
export const OPERATOR = { actor: 'system:import-docket', login: 'docket-cloud-operator' } as const satisfies Publisher

export class ImportRefused extends Error {
  override name = 'ImportRefused'
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(problems.length ? `${message}\n${problems.map((problem) => `  ${problem}`).join('\n')}` : message)
  }
}

/** Raised inside the transaction to roll a dry run back. */
class DryRun extends Error {
  constructor(readonly result: ImportResult) {
    super('dry run')
  }
}

/**
 * Reads a `.docket` directory the way docket does: `entities.yaml`, and every
 * Markdown file under it outside `.index/` and `.cache/`.
 */
export async function readDocketTree(dir: string): Promise<DocketTree> {
  const projectRoot = dirname(dir)
  const source = filesystemSource({
    config: memoryConfigSchema.parse({ version: 2, adapters: [] }),
    projectRoot,
    memoryRoot: dir,
    ontologyPath: join(dir, 'entities.yaml'),
  })
  let ontology: string
  try {
    ontology = await readFile(join(dir, 'entities.yaml'), 'utf8')
  } catch {
    throw new ImportRefused(`${dir} has no entities.yaml: is it a .docket directory?`)
  }
  // Paths as docket records them (relative to the project root), re-rooted at `.docket/` whatever the directory is called.
  const prefix = `${basename(dir)}/`
  const documents: DocketTree['documents'] = []
  const unreadable: string[] = []
  for await (const document of source.documents()) {
    const path = `.docket/${document.path.slice(prefix.length)}`
    if ('raw' in document) documents.push({ path, raw: document.raw })
    else unreadable.push(`${path}: ${document.error}`)
  }
  if (unreadable.length) throw new ImportRefused('Some files could not be read.', unreadable)
  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { ontology, documents }
}

/** A tree from untrusted JSON (the `-` input), checked for shape only; the import checks the rest. */
export function parseDocketTree(text: string): DocketTree {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ImportRefused('The input is not JSON.')
  }
  const tree = value as Partial<DocketTree> | null
  const documents = tree?.documents
  if (
    typeof tree?.ontology !== 'string' ||
    !Array.isArray(documents) ||
    !documents.every((d: unknown) => typeof (d as { path?: unknown })?.path === 'string' && typeof (d as { raw?: unknown })?.raw === 'string')
  ) {
    throw new ImportRefused('The input is not a packed docket tree: { "ontology": string, "documents": [{ "path", "raw" }] }.')
  }
  return { ontology: tree.ontology, documents: documents.map(({ path, raw }) => ({ path, raw })) }
}

export interface ImportResult {
  org: string
  workspace: string
  /** The version the import published, or null when the workspace's ontology already matched. */
  ontologyPublished: number | null
  /** The workspace's ontology head after the import. */
  ontologyHead: number
  written: string[]
  unchanged: number
  /** Live documents in the workspace after the import. */
  documents: number
  warnings: Diagnostic[]
  dryRun: boolean
}

export interface ImportDeps {
  router: TenantRouter
  keyring: Keyring
}

/** True when two ontology texts load to the same ontology: formatting, comments and key order aside. */
function sameOntology(a: string, b: string): boolean {
  return JSON.stringify(canonical(parseDraft(a).ontology)) === JSON.stringify(canonical(parseDraft(b).ontology))
}

/** `value` with every object's keys sorted, so key order does not count as a difference. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  )
}

/**
 * Imports `tree` into the workspace `workspaceSlug` of the org `orgSlug`, in
 * one transaction as the org: nothing is written unless all of it is. When
 * the workspace's published ontology differs from the tree's, the tree's is
 * published first, through the change check, which refuses a change that
 * would break or narrow the workspace's documents. Unchanged documents and a
 * matching ontology write nothing, so a repeat import changes nothing, and
 * writes no audit event. Documents the workspace has and the tree does not
 * are left as they are.
 */
export async function importDocketTree(
  deps: ImportDeps,
  input: { orgSlug: string; workspaceSlug: string; tree: DocketTree; dryRun?: boolean; requestId?: string },
): Promise<ImportResult> {
  const startedAt = performance.now()
  const { tree } = input

  const problems: string[] = []
  const imported = importYaml(tree.ontology)
  for (const d of imported.diagnostics) if (d.severity === 'error') problems.push(`${CLOUD_ONTOLOGY_PATH}: ${d.message}`)
  const paths = new Set<string>()
  for (const document of tree.documents) {
    if (!document.path.startsWith('.docket/')) problems.push(`${document.path}: a document lives under .docket/.`)
    if (paths.has(document.path)) problems.push(`${document.path}: listed twice.`)
    paths.add(document.path)
    try {
      checkDocument(document.path, document.raw)
    } catch (caught) {
      if (!(caught instanceof DocumentError)) throw caught
      problems.push(caught.message)
    }
  }
  if (problems.length) throw new ImportRefused('The tree does not import.', problems)

  const org = await deps.router.withPlatform(async (tx) => {
    const { rows } = await tx.query<{ id: string; status: string }>('SELECT id, status FROM platform.orgs WHERE slug = $1', [input.orgSlug])
    return rows[0] ?? null
  })
  if (!org || org.status === 'deleted') throw new ImportRefused(`No org "${input.orgSlug}". The import never creates one.`)
  if (org.status !== 'active') throw new ImportRefused(`The org "${input.orgSlug}" is ${org.status}, not active.`)
  const keys = await deps.keyring.forOrg(org.id)
  const requestId = input.requestId ?? randomUUID()

  const run = async (ctx: StoreContext): Promise<ImportResult> => {
    const workspace = await workspaceBySlug(ctx.tx, input.workspaceSlug)
    if (!workspace) throw new ImportRefused(`The org "${input.orgSlug}" has no workspace "${input.workspaceSlug}". The import never creates one.`)
    const events: Omit<AuditEventInput, 'latencyMs'>[] = []
    const event = (action: string, target: string[], args?: unknown) =>
      events.push({ orgId: org.id, workspaceId: workspace.id, actor: OPERATOR.actor, userAgent: 'docket-cloud import-docket', action, target, args, outcome: 'ok', requestId })

    const head = await headOf(ctx.tx, workspace.id)
    let ontologyPublished: number | null = null
    if (!head || !sameOntology(head.yaml, imported.yaml)) {
      const draft = await createDraft(ctx.tx, workspace.id, { yaml: imported.yaml, source: 'import', author: OPERATOR.actor, message: 'Imported' })
      event('ontology.import', [`ontology-draft:${draft.id}`])
      try {
        const published = await publish(ctx, workspace.id, draft.id, { expectedHead: head?.number ?? 0, publisher: OPERATOR, message: 'Imported' })
        ontologyPublished = published.number
        event('ontology.publish', [`ontology:v${published.number}`], { classification: published.checkResult?.classification })
      } catch (caught) {
        if (caught instanceof OntologyBreakingChange || caught instanceof OntologyNarrowingChange) {
          throw new ImportRefused(`The tree's ontology would not publish over v${head?.number ?? 0}: ${caught.message}. Change it in the ontology editor first.`)
        }
        throw caught
      }
    }

    const written: string[] = []
    let unchanged = 0
    for (const document of tree.documents) {
      try {
        const { document: record, changed } = await putDocument(ctx, { workspaceId: workspace.id, path: document.path, raw: document.raw, origin: 'cloud', actor: OPERATOR.actor })
        if (changed) written.push(record.resourceId)
        else unchanged += 1
      } catch (caught) {
        if (caught instanceof DocumentError) throw new ImportRefused(caught.message)
        throw caught
      }
    }

    // docket's validator over the workspace as it now stands, as the documents page shows it.
    const validation = await validate({ source: postgresSource(ctx, workspace.id) })
    const errors = validation.diagnostics.filter((d) => d.severity === 'error' && (d.path === undefined || paths.has(d.path)))
    if (errors.length) throw new ImportRefused('The documents do not validate against the ontology.', errors.map((d) => `${d.path ?? CLOUD_ONTOLOGY_PATH}: ${d.message}`))
    if (written.length) event('documents.import', written, { files: tree.documents.length })

    const result: ImportResult = {
      org: input.orgSlug,
      workspace: input.workspaceSlug,
      ontologyPublished,
      ontologyHead: ontologyPublished ?? head?.number ?? 0,
      written,
      unchanged,
      documents: validation.files.size,
      warnings: validation.diagnostics.filter((d) => d.severity === 'warning' && d.path !== undefined && paths.has(d.path)),
      dryRun: input.dryRun === true,
    }
    if (input.dryRun) throw new DryRun(result)
    for (const fields of events) await audit(ctx.tx, { ...fields, latencyMs: performance.now() - startedAt })
    return result
  }

  try {
    return await deps.router.withTenant(org.id, (tx) => run({ tx, keys }))
  } catch (caught) {
    if (caught instanceof DryRun) return caught.result
    throw caught
  }
}
