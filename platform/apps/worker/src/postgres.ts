// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'

import pg from 'pg'

/**
 * A pool on the request role, from the standard `PG*` variables. TLS is
 * always on and verifies the server's name against `PGSSLROOTCERT`;
 * `PGSSLMODE=disable` exists for a local preview and is refused in production.
 */
export function createPool(max: number, onError: (message: string) => void): pg.Pool {
  const env = process.env
  const host = env.PGHOST
  if (!host) throw new Error('PGHOST is not set')
  const plaintext = env.PGSSLMODE === 'disable'
  if (plaintext && env.NODE_ENV === 'production') throw new Error('PGSSLMODE=disable is refused in production')
  const caFile = env.PGSSLROOTCERT
  const pool = new pg.Pool({
    host,
    port: Number(env.PGPORT ?? 5432),
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    ssl: plaintext ? false : caFile ? { ca: readFileSync(caFile, 'utf8'), servername: host, rejectUnauthorized: true } : { rejectUnauthorized: true },
    max,
    connectionTimeoutMillis: 5_000,
  })
  pool.on('error', (error) => onError(`postgres pool: ${error.message}`))
  return pool
}
