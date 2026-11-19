import { randomBytes } from 'node:crypto'

import type { PeopleDirectory } from '../docket.js'
import type { DocumentCodec, StoreContext, StoreLimits, StoreRunner, Tx } from '../ports.js'

/**
 * The slice of a Postgres driver the store uses: a pool that hands out
 * clients. A `pg.Pool` is one; the core imports no driver, so a deployment
 * brings its own.
 */
export interface PoolClient extends Tx {
  /** Back to the pool; `true` destroys a client whose state is unknown. */
  release(destroy?: boolean): void
}

export interface Pool {
  connect(): Promise<PoolClient>
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Quotes a SQL identifier. Only lowercase letters, digits and underscores are
 * accepted, so a schema name built from an id can never break out.
 */
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not a safe SQL identifier: ${JSON.stringify(name)}`)
  return `"${name}"`
}

/** Runs `fn` in one transaction on a pooled client: commit on success, roll back on any error. */
export async function transaction<T>(pool: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
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
    // A client whose rollback failed is not handed to the next caller.
    client.release(broken)
  }
}

export interface PostgresStoreOptions {
  pool: Pool
  /** The schema the store's tables are in, as `migrate` made them; `public` by default. */
  schema?: string
  codec: DocumentCodec
  limits?: StoreLimits
  /** The people directory the store's workspaces score person sources by. */
  people?: PeopleDirectory
}

/**
 * One Postgres store as a `StoreRunner`: each `run` is one transaction with
 * the store's schema first on its search path, so the store's queries name
 * its tables unqualified, as they do in every schema a deployment keeps.
 */
export function postgresStore(options: PostgresStoreOptions): StoreRunner {
  const schema = ident(options.schema ?? 'public')
  return {
    run<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T> {
      return transaction(options.pool, async (tx) => {
        await tx.query(`SET LOCAL search_path TO ${schema}, public`)
        return fn({ tx, codec: options.codec, ...(options.limits ? { limits: options.limits } : {}), ...(options.people ? { people: options.people } : {}) })
      })
    }
  }
}

/** A new workspace or row id: 12 characters of lowercase letters and digits. */
export function newId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join('')
}
