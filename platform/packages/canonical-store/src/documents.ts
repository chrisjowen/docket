// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'

import { decryptText, encrypt } from '@docket/platform-keys'
import { LIMITS, type Tx } from '@docket/platform-tenancy'

import { hashContent, parseMemoryFile, type Diagnostic } from './docket.js'
import type { OrgKeyring } from './keyring.js'
import { enqueue } from './workspaces.js'

/**
 * Canonical documents (§6.1): docket Markdown files, each whole file
 * encrypted under the org's data key, with every revision kept. Every
 * function runs inside the org's `withTenant` transaction.
 */
export type Origin = 'repo' | 'cloud' | 'cli'

/** A transaction inside one org, with that org's data keys. */
export interface StoreContext {
  tx: Tx
  keys: OrgKeyring
}

export interface DocumentRecord {
  id: string
  workspaceId: string
  origin: Origin
  /** For `repo`: the connection and repo path; for `cli`: the checkout id; null for `cloud`. */
  originRef: string | null
  path: string
  resourceId: string
  resourceType: string
  /** `sha256:` over the plaintext, as docket computes it. */
  hash: string
  revision: number
  dekVersion: number
  createdBy: string
  createdAt: Date
  retiredAt: Date | null
}

export class DocumentError extends Error {
  override name = 'DocumentError'
  constructor(
    readonly code: 'invalid' | 'too-large' | 'limit' | 'not-found',
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message)
  }
}

/** The associated data that binds a ciphertext to its row and revision (§7.3). */
export function documentAad(parts: { orgId: string; workspaceId: string; documentId: string; revision: number }): string {
  return `${parts.orgId}|${parts.workspaceId}|${parts.documentId}|${parts.revision}`
}

type DocumentRow = {
  id: string
  workspace_id: string
  origin: Origin
  origin_ref: string | null
  path: string
  resource_id: string
  resource_type: string
  hash: string
  revision: number
  dek_version: number
  created_by: string
  created_at: Date
  retired_at: Date | null
}

type SealedRow = DocumentRow & { raw_ciphertext: Buffer; raw_nonce: Buffer }

const COLUMNS =
  'id, workspace_id, origin, origin_ref, path, resource_id, resource_type, hash, revision, dek_version, created_by, created_at, retired_at'

const toRecord = (row: DocumentRow): DocumentRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  origin: row.origin,
  originRef: row.origin_ref,
  path: row.path,
  resourceId: row.resource_id,
  resourceType: row.resource_type,
  hash: row.hash,
  revision: row.revision,
  dekVersion: row.dek_version,
  createdBy: row.created_by,
  createdAt: row.created_at,
  retiredAt: row.retired_at,
})

/** A posix path relative to the workspace root, without `.` or `..` segments, naming a Markdown file. */
export function pathProblem(path: string): string | null {
  if (path.length === 0 || path.length > 512) return 'A document path is 1-512 characters.'
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return 'Use a relative path with forward slashes.'
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'A document path has no empty, "." or ".." segments.'
  }
  if (!path.endsWith('.md')) return 'A document is a Markdown file: its path ends in .md.'
  return null
}

/**
 * Where a document written in the cloud lives (§6.1): the path it would have
 * in a repo, `.docket/resources/<type>/<slug>.md`, the slug being its id
 * without the type prefix.
 */
export function cloudDocumentPath(document: { id: string; type: string }): string {
  const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|-+$/g, '') || 'resource'
  const slug = document.id.startsWith(`${document.type}.`) ? document.id.slice(document.type.length + 1) : document.id
  return `.docket/resources/${safe(document.type)}/${safe(slug)}.md`
}

/** Checks a document the way the store will hold it, without writing: its path, size and structure. */
export function checkDocument(path: string, raw: string) {
  const problem = pathProblem(path)
  if (problem) throw new DocumentError('invalid', `${path}: ${problem}`)
  if (Buffer.byteLength(raw, 'utf8') > LIMITS.documentBytes) {
    throw new DocumentError('too-large', `${path}: a document holds at most ${LIMITS.documentBytes / 1024} KB.`)
  }
  const parsed = parseMemoryFile(raw, path)
  if (!parsed.document) {
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error')
    throw new DocumentError(
      'invalid',
      `${path}: ${errors.map((d) => d.message).join(' ') || 'not a docket document'}`,
      parsed.diagnostics,
    )
  }
  return parsed.document
}

async function seal(ctx: StoreContext, workspaceId: string, documentId: string, revision: number, raw: string) {
  const aad = documentAad({ orgId: ctx.keys.orgId, workspaceId, documentId, revision })
  const sealed = await encrypt(ctx.keys.key(), raw, aad)
  return { ciphertext: Buffer.from(sealed.ciphertext), nonce: Buffer.from(sealed.nonce), dekVersion: ctx.keys.version }
}

/**
 * Writes a document at its path: a new document, or a new revision of the
 * live one there. Unchanged text writes nothing. The document must parse as
 * docket's frontmatter; validation against the ontology is the caller's.
 */
export async function putDocument(
  ctx: StoreContext,
  input: { workspaceId: string; path: string; raw: string; origin: Origin; originRef?: string | null; actor: string },
): Promise<{ document: DocumentRecord; changed: boolean }> {
  const parsed = checkDocument(input.path, input.raw)
  const hash = hashContent(input.raw)
  const { tx } = ctx
  const { rows } = await tx.query<DocumentRow>(
    `SELECT ${COLUMNS} FROM documents WHERE workspace_id = $1 AND path = $2 AND retired_at IS NULL FOR UPDATE`,
    [input.workspaceId, input.path],
  )
  const live = rows[0]
  if (live?.hash === hash) return { document: toRecord(live), changed: false }

  let row: DocumentRow
  if (live) {
    const revision = live.revision + 1
    const sealed = await seal(ctx, input.workspaceId, live.id, revision, input.raw)
    const updated = await tx.query<DocumentRow>(
      `UPDATE documents SET origin = $2, origin_ref = $3, resource_id = $4, resource_type = $5, raw_ciphertext = $6,
              raw_nonce = $7, dek_version = $8, hash = $9, revision = $10
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [live.id, input.origin, input.originRef ?? null, parsed.id, parsed.type, sealed.ciphertext, sealed.nonce, sealed.dekVersion, hash, revision],
    )
    row = updated.rows[0] as DocumentRow
  } else {
    // Serialised per workspace, so the document limit holds under concurrent writes.
    await tx.query('SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE', [input.workspaceId])
    const { rows: count } = await tx.query<{ count: string }>(
      'SELECT count(*) FROM documents WHERE workspace_id = $1 AND retired_at IS NULL',
      [input.workspaceId],
    )
    if (Number(count[0]?.count ?? 0) >= LIMITS.documentsPerWorkspace) {
      throw new DocumentError('limit', `A workspace holds at most ${LIMITS.documentsPerWorkspace} documents in the beta.`)
    }
    const id = randomUUID()
    const sealed = await seal(ctx, input.workspaceId, id, 1, input.raw)
    const inserted = await tx.query<DocumentRow>(
      `INSERT INTO documents (id, workspace_id, origin, origin_ref, path, resource_id, resource_type, raw_ciphertext,
                              raw_nonce, dek_version, hash, revision, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12) RETURNING ${COLUMNS}`,
      [id, input.workspaceId, input.origin, input.originRef ?? null, input.path, parsed.id, parsed.type, sealed.ciphertext, sealed.nonce, sealed.dekVersion, hash, input.actor],
    )
    row = inserted.rows[0] as DocumentRow
  }
  await tx.query(
    `INSERT INTO document_revisions (document_id, revision, raw_ciphertext, raw_nonce, dek_version, hash, created_by)
     SELECT id, revision, raw_ciphertext, raw_nonce, dek_version, hash, $2 FROM documents WHERE id = $1`,
    [row.id, input.actor],
  )
  await enqueue(tx, input.workspaceId, 'documents')
  return { document: toRecord(row), changed: true }
}

/** Retires the live document at a path (a soft delete, §6.1). It leaves the projections at the next reconciliation. */
export async function retireDocument(tx: Tx, input: { workspaceId: string; path: string }): Promise<DocumentRecord> {
  const { rows } = await tx.query<DocumentRow>(
    `UPDATE documents SET retired_at = now() WHERE workspace_id = $1 AND path = $2 AND retired_at IS NULL
     RETURNING ${COLUMNS}`,
    [input.workspaceId, input.path],
  )
  if (!rows[0]) throw new DocumentError('not-found', `No live document at ${input.path}.`)
  await enqueue(tx, input.workspaceId, 'documents')
  return toRecord(rows[0])
}

/** The workspace's live documents, without their text, in path order. */
export async function listDocuments(tx: Tx, workspaceId: string): Promise<DocumentRecord[]> {
  const { rows } = await tx.query<DocumentRow>(
    `SELECT ${COLUMNS} FROM documents WHERE workspace_id = $1 AND retired_at IS NULL ORDER BY path`,
    [workspaceId],
  )
  return rows.map(toRecord)
}

/** When each live resource last changed: its newest document's current revision, else when that document was created. */
export async function resourceChanges(tx: Tx, workspaceId: string): Promise<Map<string, Date>> {
  const { rows } = await tx.query<{ resource_id: string; changed_at: Date }>(
    `SELECT d.resource_id, max(coalesce(r.created_at, d.created_at)) AS changed_at
       FROM documents d LEFT JOIN document_revisions r ON r.document_id = d.id AND r.revision = d.revision
      WHERE d.workspace_id = $1 AND d.retired_at IS NULL GROUP BY d.resource_id`,
    [workspaceId],
  )
  return new Map(rows.map((row) => [row.resource_id, row.changed_at]))
}

export async function countDocuments(tx: Tx, workspaceId: string): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    'SELECT count(*) FROM documents WHERE workspace_id = $1 AND retired_at IS NULL',
    [workspaceId],
  )
  return Number(rows[0]?.count ?? 0)
}

/** A live document as a listing pages through it: its revision's time, and its text when asked for. */
export interface ListedDocument {
  path: string
  hash: string
  origin: Origin
  originRef: string | null
  revision: number
  /** When its current revision was written. */
  updatedAt: Date
  /** The plaintext, when asked for and the row opened. */
  raw?: string
}

export interface DocumentPageQuery {
  workspaceId: string
  origin?: Origin
  originRef?: string
  /** The last path of the previous page: this page starts after it. */
  after?: string
  limit: number
  /** Include each document's text. */
  raw?: boolean
}

/**
 * One page of the workspace's live documents in path order, narrowed by
 * origin and origin ref; `next` is the last path when more follow. A row that
 * does not open is listed without its text.
 */
export async function listDocumentPage(ctx: StoreContext, query: DocumentPageQuery): Promise<{ documents: ListedDocument[]; next: string | null }> {
  const values: unknown[] = [query.workspaceId]
  const param = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }
  const where = ['d.workspace_id = $1', 'd.retired_at IS NULL']
  if (query.origin) where.push(`d.origin = ${param(query.origin)}`)
  if (query.originRef !== undefined) where.push(`d.origin_ref = ${param(query.originRef)}`)
  if (query.after !== undefined) where.push(`d.path > ${param(query.after)}`)
  const { rows } = await ctx.tx.query<SealedRow & { updated_at: Date }>(
    `SELECT ${COLUMNS.split(', ').map((column) => `d.${column}`).join(', ')}, r.created_at AS updated_at
            ${query.raw ? ', d.raw_ciphertext, d.raw_nonce' : ''}
       FROM documents d JOIN document_revisions r ON r.document_id = d.id AND r.revision = d.revision
      WHERE ${where.join(' AND ')} ORDER BY d.path LIMIT ${param(query.limit + 1)}`,
    values,
  )
  const page = rows.slice(0, query.limit)
  const documents = await Promise.all(
    page.map(async (row) => {
      const listed: ListedDocument = {
        path: row.path,
        hash: row.hash,
        origin: row.origin,
        originRef: row.origin_ref,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
      if (!query.raw) return listed
      const opened = await openRow(ctx.keys, row)
      return opened.raw === undefined ? listed : { ...listed, raw: opened.raw }
    }),
  )
  return { documents, next: rows.length > query.limit ? (page.at(-1)?.path ?? null) : null }
}

export interface OpenedDocument extends DocumentRecord {
  /** The plaintext; absent when the row did not open. */
  raw?: string
  /** Why the row did not open: a wrong key or associated data, or a hash that does not match. */
  error?: string
}

/** Opens a sealed row: decrypts it and checks the plaintext still hashes as recorded. */
export async function openRow(
  keys: OrgKeyring,
  row: { id: string; workspace_id: string; revision: number; dek_version: number; hash: string; raw_ciphertext: Buffer; raw_nonce: Buffer },
): Promise<{ raw?: string; error?: string }> {
  try {
    const raw = await decryptText(
      keys.key(row.dek_version),
      { ciphertext: new Uint8Array(row.raw_ciphertext), nonce: new Uint8Array(row.raw_nonce) },
      documentAad({ orgId: keys.orgId, workspaceId: row.workspace_id, documentId: row.id, revision: row.revision }),
    )
    if (hashContent(raw) !== row.hash) return { error: 'the decrypted text does not match its recorded hash' }
    return { raw }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/** Every live document of the workspace, decrypted, in path order. A row that does not open carries `error`. */
export async function readDocuments(ctx: StoreContext, workspaceId: string): Promise<OpenedDocument[]> {
  const { rows } = await ctx.tx.query<SealedRow>(
    `SELECT ${COLUMNS}, raw_ciphertext, raw_nonce FROM documents
      WHERE workspace_id = $1 AND retired_at IS NULL ORDER BY path`,
    [workspaceId],
  )
  return Promise.all(rows.map(async (row) => ({ ...toRecord(row), ...(await openRow(ctx.keys, row)) })))
}

/** One live document by path, decrypted, or null. */
export async function readDocument(ctx: StoreContext, workspaceId: string, path: string): Promise<OpenedDocument | null> {
  const { rows } = await ctx.tx.query<SealedRow>(
    `SELECT ${COLUMNS}, raw_ciphertext, raw_nonce FROM documents
      WHERE workspace_id = $1 AND path = $2 AND retired_at IS NULL`,
    [workspaceId, path],
  )
  const row = rows[0]
  return row ? { ...toRecord(row), ...(await openRow(ctx.keys, row)) } : null
}
