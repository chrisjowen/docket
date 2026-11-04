import {
  CloudApiError,
  CloudAuthError,
  CloudUnreachableError,
  CloudWorkspace,
  CredentialStore,
  DEFAULT_CLOUD_URL,
  cloudOrigin,
  packageVersion,
  parseAdapterConfig
} from '@docket/adapter-kit'
import type {
  AdapterAnswer,
  AdapterDefinition,
  AdapterServices,
  AdapterStatus,
  AskRequest,
  EntityBlockItem,
  MemoryAdapter,
  RetrievedEvidence
} from '@docket/contracts'
import { z } from 'zod'

const VERSION = packageVersion(new URL('../package.json', import.meta.url))

/** The cloud's org and workspace slugs, as its URLs carry them. */
const SLUG = '[a-z0-9-]{1,40}'

/**
 * A `cloud` adapter instance's config, as `docket cloud link` writes it.
 * `tokenEnv` names an environment variable holding an API token - for CI;
 * without it the session `docket cloud login` keeps is used. Never a token itself.
 */
export const cloudConfigSchema = z.strictObject({
  url: z
    .string()
    .default(DEFAULT_CLOUD_URL)
    .refine((url) => {
      try {
        cloudOrigin(url)
        return true
      } catch {
        return false
      }
    }, 'must be an https URL (plain http only on this machine)'),
  workspace: z.string().regex(new RegExp(`^${SLUG}/${SLUG}$`), 'must be <org>/<workspace>, e.g. acme/platform'),
  tokenEnv: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be an environment variable name')
    .optional()
})

export type CloudConfig = z.infer<typeof cloudConfigSchema>

/** The most results one question asks the cloud for: `docket_search` takes at most 50. */
const MAX_LIMIT = 50

/** A match as `docket_search` returns it (`docket-search.v1`). */
interface SearchMatch {
  id: string
  type: string
  title: string
  path?: string
  confidence?: number
}

interface SearchGraph {
  matches?: SearchMatch[]
  viewer?: string
}

/** Why the cloud could not answer, safe to show: never a token. */
const reasonOf = (cause: unknown): string => {
  if (cause instanceof CloudUnreachableError || cause instanceof CloudAuthError || cause instanceof CloudApiError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * The cloud workspace's answer in docket's terms. Every match is a passage of
 * evidence naming the resource, so `docket ask` shows it whether or not this
 * checkout has the resource. Only the matches this checkout holds are entity
 * hits too: an adapter cannot introduce entities (adapter-spec §9), so a hit
 * for one only the cloud holds would be dropped as a stale index.
 */
export const toAnswer = async (
  graph: SearchGraph,
  request: AskRequest,
  workspace: CloudWorkspace,
  holds: (id: string) => Promise<boolean>
): Promise<AdapterAnswer> => {
  const matches = (graph.matches ?? []).slice(0, request.budget.maxResults)
  const evidence: RetrievedEvidence[] = []
  const entities: EntityBlockItem[] = []
  let bytes = 0
  for (const [index, match] of matches.entries()) {
    const text = `${match.title} (${match.type} ${match.id})${match.path ? ` - ${match.path}` : ''} in ${workspace.org}/${workspace.workspace}`
    bytes += Buffer.byteLength(text, 'utf8')
    if (bytes > request.budget.maxEvidenceBytes) break
    const id = `match-${index + 1}`
    evidence.push({
      id,
      nativeId: match.id,
      kind: 'passage',
      text,
      canonicalRefs: [{ kind: 'entity', id: match.id }],
      score: matches.length - index
    })
    if (await holds(match.id)) {
      entities.push({ ref: { kind: 'entity', id: match.id }, score: matches.length - index, detail: `in ${workspace.org}/${workspace.workspace}` })
    }
  }
  const elsewhere = evidence.length - entities.length
  const found = `${evidence.length} match${evidence.length === 1 ? '' : 'es'} in ${workspace.label}`
  return {
    interpretation: {
      description:
        elsewhere > 0
          ? `${found}; ${elsewhere} only in the cloud (docket ask shows them${graph.viewer ? `, as does ${graph.viewer}` : ''})`
          : found,
      assumptions: []
    },
    blocks: [
      ...(entities.length > 0 ? [{ kind: 'entities' as const, id: 'cloud-entities', evidenceIds: [], entities }] : []),
      ...(evidence.length > 0
        ? [{ kind: 'passages' as const, id: 'cloud-matches', title: `Docket Cloud: ${workspace.org}/${workspace.workspace}`, evidenceIds: evidence.map((item) => item.id) }]
        : [])
    ],
    evidence,
    coverage: { mode: 'top-k', truncated: evidence.length < (graph.matches ?? []).length || evidence.length >= request.budget.maxResults, scope: request.context.scope },
    diagnostics: []
  }
}

/** The workspace the instance asks, signed in with the token `tokenEnv` names or the stored session. */
const workspaceFor = async (config: CloudConfig, services: AdapterServices, store?: CredentialStore): Promise<CloudWorkspace> => {
  const [org, workspace] = config.workspace.split('/') as [string, string]
  let token: string | undefined
  if (config.tokenEnv !== undefined) {
    token = await services.secrets.getEnv(config.tokenEnv)
    if (token === undefined || token === '') throw new CloudAuthError(`${config.tokenEnv} is not set: it should hold an API token for ${config.workspace}`)
  }
  return new CloudWorkspace({ url: config.url, org, workspace, token, store })
}

/** Builds the adapter; `store` is for tests, which keep their sessions apart from the user's. */
export const createCloudAdapter = (config: CloudConfig, services: AdapterServices, store?: CredentialStore): MemoryAdapter => ({
  describe: () => ({ name: 'cloud', version: VERSION, inputs: [], resultKinds: ['entities', 'passages'], rebuild: 'unsupported' }),

  async status(signal): Promise<AdapterStatus> {
    try {
      const workspace = await workspaceFor(config, services, store)
      await workspace.listTools(signal)
      return { state: 'connected', message: `signed in to ${workspace.label}` }
    } catch (cause) {
      return { state: 'unavailable', message: reasonOf(cause) }
    }
  },

  query: {
    async ask(request) {
      const workspace = await workspaceFor(config, services, store)
      const { structured } = await workspace.callTool<SearchGraph>(
        'docket_search',
        { query: request.question, limit: Math.min(request.budget.maxResults, MAX_LIMIT) },
        request.signal
      )
      return toAnswer(structured ?? {}, request, workspace, async (id) => (await services.canonical.get('entity', id)) !== undefined)
    }
  },

  close: async () => {}
})

/**
 * The cloud adapter: answers questions from a Docket Cloud workspace through
 * its MCP `docket_search`, beside the local adapters. Query only - it projects
 * nothing. Offline or signed out, it is one failed adapter the coordinator
 * reports, never a failed question (adapter-spec §10).
 */
const definition: AdapterDefinition<CloudConfig> = {
  apiVersion: 1,
  name: 'cloud',
  validateConfig: (input) => parseAdapterConfig(cloudConfigSchema, input),
  create: async (config, services) => createCloudAdapter(config, services)
}

export default definition
