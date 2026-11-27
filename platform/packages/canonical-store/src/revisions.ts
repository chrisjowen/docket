// SPDX-License-Identifier: AGPL-3.0-only
import { openRow, type StoreContext } from './documents.js'

/** One earlier or current text of a document (§6.1): browsable, so a bad write can be reverted. */
export interface Revision {
  documentId: string
  revision: number
  hash: string
  createdBy: string
  createdAt: Date
  raw?: string
  error?: string
}

type RevisionRow = {
  document_id: string
  workspace_id: string
  revision: number
  hash: string
  dek_version: number
  created_by: string
  created_at: Date
  raw_ciphertext: Buffer
  raw_nonce: Buffer
}

/** Every revision of a document in the workspace, newest first, decrypted. Empty for a document it does not hold. */
export async function documentHistory(ctx: StoreContext, workspaceId: string, documentId: string): Promise<Revision[]> {
  const { rows } = await ctx.tx.query<RevisionRow>(
    `SELECT r.document_id, d.workspace_id, r.revision, r.hash, r.dek_version, r.created_by, r.created_at,
            r.raw_ciphertext, r.raw_nonce
       FROM document_revisions r JOIN documents d ON d.id = r.document_id
      WHERE d.workspace_id = $1 AND r.document_id = $2
      ORDER BY r.revision DESC`,
    [workspaceId, documentId],
  )
  return Promise.all(
    rows.map(async (row) => ({
      documentId: row.document_id,
      revision: row.revision,
      hash: row.hash,
      createdBy: row.created_by,
      createdAt: row.created_at,
      ...(await openRow(ctx.keys, { ...row, id: row.document_id })),
    })),
  )
}
