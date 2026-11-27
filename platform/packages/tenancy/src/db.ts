// SPDX-License-Identifier: AGPL-3.0-only
import type pg from 'pg'

/** A connection inside an open transaction. */
export type Tx = pg.ClientBase

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Quotes a SQL identifier. Only lowercase letters, digits and underscores are
 * accepted, so a name built from a checked tenant id can never break out.
 */
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${JSON.stringify(name)}`)
  return `"${name}"`
}

/** Runs `fn` in one transaction on a pooled connection: commit on success, roll back on any error. */
export async function transaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      broken = true
    }
    throw error
  } finally {
    // A connection whose rollback failed is not handed to the next request.
    client.release(broken)
  }
}
