// Creates the restricted request role for installer-owned evaluation Postgres.
// The owner runs migrations in docket serve; the app connects as docket_app.
import pg from 'pg'

const { DOCKET_PG_URL, DOCKET_PG_MIGRATION_URL } = process.env
const request = new URL(DOCKET_PG_URL)
const password = decodeURIComponent(request.password)
if (request.username !== 'docket_app' || !password) throw new Error('bundled Postgres requires a password for docket_app')

const admin = new pg.Client({ connectionString: DOCKET_PG_MIGRATION_URL, connectionTimeoutMillis: 5_000 })
await admin.connect()
try {
  await admin.query('BEGIN')
  await admin.query("SELECT pg_advisory_xact_lock(hashtext('docket:bundled-postgres-bootstrap'))")
  const { rows } = await admin.query(`
    SELECT rolcanlogin AND NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls) AS restricted
    FROM pg_roles WHERE rolname = 'docket_app'
  `)
  if (!rows.length) {
    await admin.query(`CREATE ROLE docket_app LOGIN NOINHERIT PASSWORD ${pg.escapeLiteral(password)}`)
  } else if (!rows[0].restricted) {
    throw new Error('the existing docket_app role does not have the restricted request role settings')
  }
  await admin.query('COMMIT')
} finally {
  await admin.end()
}

// On restart, check the saved credentials before starting the workloads.
const app = new pg.Client({ connectionString: DOCKET_PG_URL, connectionTimeoutMillis: 5_000 })
await app.connect()
await app.end()
