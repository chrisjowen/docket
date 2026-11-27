// SPDX-License-Identifier: AGPL-3.0-only
/** What `/readyz` needs to know about the process (§15.2). */
export interface ReadinessProbes {
  /** True once the KEK has been read and imported. */
  kekLoaded(): boolean
  /** Resolves when Postgres answers a query; rejects otherwise. */
  pingPostgres(): Promise<void>
}

export type CheckState = 'ok' | 'down'

export interface Readiness {
  ok: boolean
  checks: { postgres: CheckState; kek: CheckState }
}

const NO_STORE = { 'cache-control': 'no-store' }

/** Liveness: the process is up and serving. It checks nothing else, so a store outage never restarts pods. */
export function healthz(): Response {
  return Response.json({ ok: true }, { headers: NO_STORE })
}

/** Readiness: 200 only when Postgres is reachable and the KEK is loaded, else 503. */
export async function readyz(
  probes: ReadinessProbes,
  log: (message: string) => void = console.error,
): Promise<Response> {
  const kek: CheckState = probes.kekLoaded() ? 'ok' : 'down'
  let postgres: CheckState = 'ok'
  try {
    await probes.pingPostgres()
  } catch (error) {
    postgres = 'down'
    log(`readyz: postgres unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  const body: Readiness = { ok: kek === 'ok' && postgres === 'ok', checks: { postgres, kek } }
  return Response.json(body, { status: body.ok ? 200 : 503, headers: NO_STORE })
}
