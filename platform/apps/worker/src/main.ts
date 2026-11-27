// SPDX-License-Identifier: AGPL-3.0-only
import { aiCaps, auditCapWarning, meteredTurns, openRouterClient, openRouterKeys, openRouterModels, type AiDeps } from '@docket/platform-ai'
import { redactConsole } from '@docket/platform-audit'
import { keyring } from '@docket/platform-canonical-store'
import { githubApp, githubAppConfigFromEnv } from '@docket/platform-github'
import { platformKeyService, readKekFile } from '@docket/platform-keys'
import {
  inClusterKube,
  neo4jPodProvisioner,
  qdrantProvisioner,
  staticNeo4jProvisioner,
  type Neo4jPodProvisioner,
} from '@docket/platform-provisioner'
import { queryKey } from '@docket/platform-mcp-tools/query'
import { CogneeUnavailable, type CogneeAccess } from '@docket/platform-projections'
import { PLATFORM_MIGRATIONS, tenantRouter } from '@docket/platform-tenancy'
import pg from 'pg'

import { cogneeLeases, cogneeLoop, openCogneeToClear } from './cognee.js'
import { gatewayDeps, startGatewayServer } from './cognify-gateway.js'
import { consolidationLoop } from './consolidation.js'
import { enrichmentLoop } from './enrichment.js'
import { expireDatabases } from './database-expiry.js'
import { exportPr } from './export-pr.js'
import { healthServer } from './health.js'
import { ensureOrgKeys } from './openrouter.js'
import { activeOrgs, outboxLoop, type Logger } from './outbox.js'
import { createPool } from './postgres.js'
import { queryService, startQueryServer } from './query.js'
import { reconciler } from './reconcile.js'
import { RERANKER_MODEL, rerankerClient } from './reranker.js'
import { repoJobLoop } from './repo-jobs.js'
import { repoSync } from './repo-sync.js'
import { reprojectOutdated } from './reproject.js'
import { orgStores } from './stores.js'

/**
 * The reconciliation worker (§6.2): projects every workspace's canonical
 * documents into its org's Neo4j and mem0, provisions each org's stores,
 * suspends idle Neo4j pods, keeps each org's OpenRouter key in line with
 * its cap, and serves the query service the API's MCP endpoint asks. It also
 * syncs connected repos on push and opens export PRs (§14), and runs each
 * workspace's background enrichment when it turns it on, and the
 * consolidation that follows each enrichment run, and projects into cognee
 * the workspaces that turn it on, where a cognee service runs. It connects to
 * Postgres as the request role, and reaches an org's rows only through
 * `withTenant`, like the API.
 */

// No credential reaches the logs, whichever line prints it (§19).
redactConsole()

const env = process.env
const log: Logger = {
  info: (message) => console.log(`${new Date().toISOString()} ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} ${message}`),
}

function required(name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function neo4jProvisioner(): Promise<Neo4jPodProvisioner> {
  if (env.DOCKET_NEO4J_URL) {
    // One shared server: for a local preview or CI, never the beta (§5.2).
    if (env.NODE_ENV === 'production') throw new Error('DOCKET_NEO4J_URL (one Neo4j for every org) is refused in production')
    return staticNeo4jProvisioner({ url: env.DOCKET_NEO4J_URL, password: required('DOCKET_NEO4J_PASSWORD') })
  }
  // DOCKET_K8S_LABEL_DOMAIN: the prefix of the org and client labels (default docket.dev).
  const labelDomain = env.DOCKET_K8S_LABEL_DOMAIN ?? 'docket.dev'
  return neo4jPodProvisioner({
    kube: await inClusterKube(),
    namespace: required('DOCKET_NAMESPACE'),
    image: env.DOCKET_NEO4J_IMAGE ?? 'neo4j:5.26-community',
    storageClass: env.DOCKET_NEO4J_STORAGE_CLASS ?? 'docket-luks',
    storageSize: env.DOCKET_NEO4J_STORAGE_SIZE ?? '2Gi',
    issuer: env.DOCKET_NEO4J_ISSUER ?? 'docket-internal-ca',
    labelDomain,
    clientLabels: { [`${labelDomain}/neo4j-client`]: 'true' },
  })
}

/** Waits until the API has migrated the platform schema to what this build expects. */
async function waitForMigrations(pool: pg.Pool): Promise<void> {
  const want = PLATFORM_MIGRATIONS.at(-1)?.version ?? 0
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { rows } = await pool.query<{ version: number | null }>(
        "SELECT max(version) AS version FROM platform.schema_migrations WHERE schema_name = 'platform'",
      )
      if ((rows[0]?.version ?? 0) >= want) return
      log.info(`waiting for the API to migrate the platform schema to v${want}`)
    } catch (error) {
      log.error(`waiting for Postgres: ${error instanceof Error ? error.message : String(error)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempt)))
  }
}

async function main(): Promise<void> {
  const kek = await readKekFile(env.DOCKET_KEK_FILE ?? '/etc/docket/kek/kek')
  const pool = createPool(Number(env.DOCKET_WORKER_PG_POOL ?? 6), log.error)
  await waitForMigrations(pool)
  const router = tenantRouter(pool)
  const others =
    env.DOCKET_KEK_OTHER_FILE && env.DOCKET_KEK_OTHER_ID
      ? [{ kek: await readKekFile(env.DOCKET_KEK_OTHER_FILE), kekId: env.DOCKET_KEK_OTHER_ID }]
      : []
  const keys = await platformKeyService({ kek, kekId: env.DOCKET_KEK_ID ?? 'platform-v1', others })
  const ring = keyring({ keys, platform: (fn) => router.withPlatform(fn) })

  const embedder = {
    url: required('DOCKET_EMBEDDER_URL'),
    model: env.DOCKET_EMBEDDER_MODEL ?? 'nomic-embed-text',
    dimension: Number(env.DOCKET_EMBEDDER_DIMENSION ?? 768),
  }
  const stores = orgStores({
    router,
    neo4j: await neo4jProvisioner(),
    qdrant: qdrantProvisioner({
      url: required('DOCKET_QDRANT_URL'),
      apiKey: required('DOCKET_QDRANT_API_KEY'),
      dimension: Number(env.DOCKET_EMBEDDER_DIMENSION ?? 768),
    }),
    embedder,
    log,
    idleMs: Number(env.DOCKET_NEO4J_IDLE_HOURS ?? 24) * 3_600_000,
  })

  // cognee, the optional projection: only where a cognee service runs (DOCKET_COGNEE_URL), and only for the
  // workspaces that turn it on. Its pass, its search and its purge all go through docket's cognee adapter.
  const cognee: CogneeAccess | null = env.DOCKET_COGNEE_URL
    ? {
        url: env.DOCKET_COGNEE_URL,
        apiKey: required('DOCKET_COGNEE_API_KEY'),
        cognifyTimeoutMs: Number(env.DOCKET_COGNIFY_TIMEOUT_MS ?? 3_600_000),
      }
    : null

  const loop = outboxLoop({
    router,
    pool,
    reconciler: reconciler({
      router,
      keyring: ring,
      storeAccess: (orgId) => stores.access(orgId),
      ...(cognee
        ? {
            purgeAlso: [
              {
                id: 'cognee',
                open: ({ orgId, workspaceId }) => openCogneeToClear(cogneeLeases({ router, access: cognee }), { router, orgId, workspaceId, access: cognee }),
                unavailable: (cause: unknown) => cause instanceof CogneeUnavailable,
              },
            ],
          }
        : {}),
    }),
    log,
    intervalMs: Number(env.DOCKET_OUTBOX_POLL_MS ?? 10_000),
  })

  // Repo sync and export PRs (§14), once the GitHub App's id and private key are configured.
  const appConfig = githubAppConfigFromEnv(env)
  const github = appConfig ? githubApp(appConfig) : null
  const repoJobs = github
    ? repoJobLoop({
        router,
        pool,
        sync: repoSync({ router, keyring: ring, github }),
        exports: exportPr({ router, keyring: ring, github, ...(env.ORIGIN ? { origin: env.ORIGIN } : {}) }),
        log,
        intervalMs: Number(env.DOCKET_REPO_JOBS_POLL_MS ?? 2_000),
      })
    : null
  if (!repoJobs) log.info('GITHUB_APP_ID, GITHUB_APP_SLUG and the app private key are not set: repo sync and export PRs stay off')

  // Every active org's stores, now and every 10 minutes: new orgs get theirs without waiting for a write.
  const provisionAll = async () => {
    for (const orgId of await activeOrgs(router)) await stores.ensure(orgId).catch(() => undefined)
  }
  const ai = openRouterKeys(
    { platform: (fn) => router.withPlatform(fn), keysFor: (orgId) => ring.forOrg(orgId) },
    { provisioningKey: env.OPENROUTER_PROVISIONING_KEY, apiKey: env.OPENROUTER_API_KEY, appUrl: env.ORIGIN },
    openRouterClient,
  )
  log.info(
    {
      'per-org': 'AI: each org gets its own OpenRouter key with a credit limit equal to its cap',
      shared: 'AI: every org shares the platform OpenRouter key; caps are enforced from recorded usage',
      off: 'AI: no OpenRouter key is configured, so AI stays off (search works)',
    }[ai.mode],
  )
  const aiDeps: AiDeps | null = ai.keys && {
    platform: (fn) => router.withPlatform(fn),
    caps: aiCaps({ platform: (fn) => router.withPlatform(fn), notifyOwners: auditCapWarning(router) }),
    keys: ai.keys,
    client: openRouterClient({ appUrl: env.ORIGIN }),
  }

  // docket_search re-ranks its candidates with the cross-encoder in the re-ranker pod (reranker.ts).
  const reranker = env.DOCKET_RERANKER_URL
    ? rerankerClient({ url: env.DOCKET_RERANKER_URL, model: RERANKER_MODEL.name, timeoutMs: Number(env.DOCKET_RERANKER_TIMEOUT_MS ?? 3_000) })
    : null
  if (!reranker) log.info('DOCKET_RERANKER_URL is not set: search cuts its results on the projections\' scores alone')

  // docket_search and docket_ask for the API's MCP endpoint (§9): only the worker reaches the stores.
  const tls = env.DOCKET_QUERY_TLS_CERT && env.DOCKET_QUERY_TLS_KEY ? { certFile: env.DOCKET_QUERY_TLS_CERT, keyFile: env.DOCKET_QUERY_TLS_KEY } : null
  const query = startQueryServer({
    service: queryService({
      router,
      keyring: ring,
      storeAccess: (orgId) => stores.access(orgId),
      models: (orgId, context) => (aiDeps ? openRouterModels(aiDeps, orgId, context) : null),
      // Turns run on the org's synthesis model, metered as what they are for: the Ask page's `agent`, or `ontology` drafts.
      turns: (orgId, context) => (aiDeps ? meteredTurns(aiDeps, orgId, { actor: context.actor }, 'synthesis', context.purpose) : null),
      reranker,
      cognee: cognee && { access: cognee },
      log,
    }),
    key: queryKey(kek),
    port: Number(env.DOCKET_QUERY_PORT ?? 8443),
    host: env.DOCKET_QUERY_HOST ?? (tls ? '0.0.0.0' : '127.0.0.1'),
    tls,
    production: env.NODE_ENV === 'production',
    log,
  })

  const housekeeping = async () => {
    for (const orgId of await activeOrgs(router)) {
      await expireDatabases(router, ring, orgId, new Date()).catch(() => log.error(`database expiry failed for org ${orgId}`))
    }
    await provisionAll().catch((error: unknown) => log.error(`provisioning: ${String(error)}`))
    // Workspaces projected by another docket release are re-projected with this one.
    await reprojectOutdated(router, log).catch((error: unknown) => log.error(`reproject: ${String(error)}`))
    await stores.sweepIdle().catch((error: unknown) => log.error(`idle sweep: ${String(error)}`))
    if (ai.mode === 'per-org' && ai.keys) await ensureOrgKeys({ router, keys: ai.keys, log }).catch((error: unknown) => log.error(`openrouter: ${String(error)}`))
  }
  void housekeeping()
  const housekeepingTimer = setInterval(() => void housekeeping(), 10 * 60_000)
  loop.start()
  repoJobs?.start()

  // Background enrichment, for the workspaces that turn it on: nightly or weekly, or when asked from Settings.
  const enrichment = enrichmentLoop({
    router,
    keyring: ring,
    ai: aiDeps,
    log,
    intervalMs: Number(env.DOCKET_ENRICHMENT_POLL_MS ?? 60_000),
  })
  enrichment.start()

  const everyHours = Number(env.DOCKET_CONSOLIDATION_EVERY_HOURS ?? 4)
  if (!(everyHours > 0)) throw new Error('DOCKET_CONSOLIDATION_EVERY_HOURS must be a number of hours above 0')
  // Background consolidation (dreaming): after each enrichment run and every few hours, a narrative summary of every
  // changed neighbourhood, and out-of-date records superseded by the newer ones that contradict them.
  const consolidation = consolidationLoop({
    router,
    keyring: ring,
    ai: aiDeps,
    embedder,
    log,
    intervalMs: Number(env.DOCKET_ENRICHMENT_POLL_MS ?? 60_000),
    everyMs: everyHours * 3_600_000,
  })
  consolidation.start()

  // cognee's pass and the gateway its cognify calls the org's model through, where a cognee service runs.
  const cogneePass = cognee
    ? cogneeLoop({ router, keyring: ring, access: cognee, ai: env.OPENROUTER_API_KEY ? aiDeps : null, log, intervalMs: Number(env.DOCKET_COGNEE_POLL_MS ?? 60_000) })
    : null
  cogneePass?.start()
  const gateway = cognee
    ? startGatewayServer({
        deps: gatewayDeps(router, aiDeps, required('DOCKET_COGNIFY_GATEWAY_KEY'), { appUrl: env.ORIGIN, platformKey: env.OPENROUTER_API_KEY }),
        port: Number(env.DOCKET_COGNIFY_GATEWAY_PORT ?? 8445),
        host: env.DOCKET_QUERY_HOST ?? (tls ? '0.0.0.0' : '127.0.0.1'),
        tls,
        production: env.NODE_ENV === 'production',
        log,
      })
    : null
  if (!cognee) log.info('DOCKET_COGNEE_URL is not set: cognee stays off for every workspace')
  else if (!env.OPENROUTER_API_KEY) log.info("OPENROUTER_API_KEY is not set: cognee cognifies on the platform's own OpenRouter key, so it waits in every workspace")

  // The probe port: the kubelet's /healthz and /readyz only; the network policies admit no pod to it.
  const server = healthServer(pool)
  server.listen(Number(env.PORT ?? 8080), '0.0.0.0')
  log.info(
    `worker up: projecting into ${env.DOCKET_NEO4J_URL ? 'one shared Neo4j (local)' : 'a Neo4j pod per org'} and Qdrant${github ? `; repo sync as GitHub App ${appConfig?.slug}` : ''}`,
  )

  const shutdown = async (signal: string) => {
    log.info(`${signal}: finishing the workspace in hand`)
    clearInterval(housekeepingTimer)
    server.close()
    query.close()
    gateway?.close()
    await loop.stop()
    await cogneePass?.stop()
    await repoJobs?.stop()
    await enrichment.stop()
    await consolidation.stop()
    await pool.end()
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  log.error(`worker failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  process.exit(1)
})
