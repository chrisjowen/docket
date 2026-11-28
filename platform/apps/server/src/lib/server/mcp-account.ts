// SPDX-License-Identifier: AGPL-3.0-only
import { createMcpServer, InvalidArgumentsError, type CanonicalSource, type Tool, type ToolRegistry, type ToolResult } from '@chrisjowen/docket'
import { operation, type OperationId } from '@docket/api'
import { docketCapScope } from '@docket/platform-ai'
import { audit, type AuditEventInput } from '@docket/platform-audit'
import { accountMcpUrl, actsFor, principalLabel, scopesOn, type AccountPrincipal, type Principal, type Scope } from '@docket/platform-auth'
import { listSpaces, listWorkspaces, type StoreContext, type Writer } from '@docket/platform-canonical-store'
import { mcpRateLimit } from '@docket/platform-limits'
import { SERVER_INSTRUCTIONS, cloudTools, type CloudTool } from '@docket/platform-mcp-tools'
import { ACCOUNT, accessOf, mayCreateSpace, placeKey, userById, type Tx } from '@docket/platform-tenancy'
import type { RequestEvent } from '@sveltejs/kit'
import { z } from 'zod'

import { accountCaller, readsOnly, type AccountCaller, type Caller } from './api/caller'
import { HANDLERS, recordCall, type ApiCall } from './api/handlers'
import { errorOf } from './api/v1'
import { placeFromRef } from './api/views'
import { bearerOf, credentialInUrl, refusedCredentials } from './bearer'
import { placeNames } from './grants'
import {
  MAX_BODY_BYTES,
  PROTOCOL_VERSIONS,
  isObject,
  jsonRpcId,
  outcomeOf,
  refusal,
  respond,
  tenantSource,
  type JsonRpcResponse,
  type Message,
} from './mcp'
import { clientAddress } from './request'
import { getRuntime } from './runtime'

/**
 * An account's MCP address (tenancy v2 §4): `POST /mcp/{org}`, one entry for
 * every docket its caller may use, beside each docket's own pinned address
 * (`/mcp/{org}/{docket}`), which is unchanged.
 *
 * - `docket_list` shows the dockets this connection or token may use, and
 *   what it can do in each.
 * - Every docket tool takes `docket` (a slug); read tools may take `dockets`
 *   to look in several at once, each result saying which docket it came from.
 * - Which docket a call uses: one implied by a credential limited to that
 *   docket alone; else the one named, checked against what the credential
 *   reaches; else, for a read, the only one it reaches; else the call fails
 *   and lists the choices. A write never falls back to a default.
 * - `?read_only=1` drops the write tools.
 * - `?admin=1` opts in to the `admin_*` management tools, offered only to a
 *   caller who can manage something, and never one that mints a token: each
 *   makes the same call as `/api/v1`, with the same capability checks.
 *
 * What a call may do on a docket is its credential's ceiling cut to its
 * owner's capabilities there, read afresh on every request, as at the pinned
 * address. Writes are the caller's own evidence; a system account's are its
 * own, with no person acting for it.
 */

const DOCKET_ARGS = ['docket', 'dockets'] as const
const MOST_DOCKETS = 10

export const ACCOUNT_INSTRUCTIONS =
  'This server is a Docket Cloud account: several dockets, each a body of knowledge. Call docket_list first to see the ' +
  'dockets you may use and what you can do in each, then name one with the docket argument on every call (read tools ' +
  'also take dockets, to look in several at once; each result says which docket it came from). A write always names ' +
  `exactly one docket. ${SERVER_INSTRUCTIONS.replace(/^This server is one Docket Cloud workspace: /, 'Each docket is ')}`

/** A docket this request may use, and what it may do there. */
interface Reach {
  id: string
  slug: string
  name: string
  space: string
  scopes: Scope[]
}

const READ_SCOPES: readonly Scope[] = ['docket:read', 'ontology:read']

/** The tools' arguments with `docket` (and `dockets`, for a read) first. */
function withDocket(definition: Tool['definition'], slugs: string[], options: { write: boolean; required: boolean }): Tool['definition'] {
  const schema = definition.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
  return {
    ...definition,
    inputSchema: {
      ...schema,
      properties: {
        docket: { type: 'string', enum: slugs, description: 'The docket to use, by its slug (docket_list lists them).' },
        ...(options.write
          ? {}
          : {
              dockets: {
                type: 'array',
                items: { type: 'string', enum: slugs },
                minItems: 1,
                maxItems: MOST_DOCKETS,
                description: 'Several dockets to look in at once, instead of docket.',
              },
            }),
        ...(schema.properties ?? {}),
      },
      required: [...(options.required ? ['docket'] : []), ...(schema.required ?? [])],
    },
  }
}

const isWrite = (entry: CloudTool) => entry.tool.definition.annotations?.readOnlyHint !== true

const failedResult = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }], isError: true })

/** An admin tool: one `/api/v1` operation (or two, for set access), as a tool with that operation's body as its arguments. */
interface AdminTool {
  name: string
  description: string
  schema: z.ZodObject
  /** Whether the caller may use it at all: it is offered only then. */
  offered(acct: AccountCaller): boolean
  run(acct: AccountCaller, args: Record<string, unknown>, call: (id: OperationId, input: { params?: Record<string, string>; query?: Record<string, unknown>; body?: Record<string, unknown> }) => Promise<unknown>): Promise<unknown>
}

const bodyOf = (id: OperationId) => operation(id).body as z.ZodObject

const ADMIN_TOOLS: AdminTool[] = [
  {
    name: 'admin_set_access',
    description:
      'Gives someone (a login, a system account name, or everyone) a role on a place (account, space:<slug> or docket:<slug>), adjusted by single capabilities with add and remove; replaces their grant there. role null takes their grant there away. You can only give what you hold, where you manage access.',
    schema: z.object({
      who: z.string().min(1).max(80),
      place: z.string().min(1).max(90),
      role: z.string().min(1).max(80).nullable(),
      add: z.array(z.string()).max(12).optional(),
      remove: z.array(z.string()).max(12).optional(),
    }),
    offered: (acct) => acct.canAnywhere('access') || acct.canAnywhere('system'),
    async run(acct, args, call) {
      if (args.role !== null) return call('grants.create', { body: args })
      const listed = (await call('grants.list', { query: { place: args.place, who: args.who } })) as { grants: { id: string; place: { ref: string } }[] }
      const names = await placeNames(acct.org.id)
      const here = placeKey(placeFromRef(String(args.place), names))
      const grant = listed.grants.find((each) => placeKey(placeFromRef(each.place.ref, names)) === here)
      if (!grant) throw new InvalidArgumentsError(`${String(args.who)} holds no grant on ${String(args.place)}.`)
      await call('grants.delete', { params: { id: grant.id } })
      return { removed: grant.id }
    },
  },
  {
    name: 'admin_invite',
    description: 'Invites someone by GitHub login or email to a role on a place (account, space:<slug> or docket:<slug>).',
    schema: bodyOf('invites.create'),
    offered: (acct) => acct.canAnywhere('access'),
    run: (_acct, args, call) => call('invites.create', { body: args }),
  },
  {
    name: 'admin_create_space',
    description: 'Makes a space, for a team, department or client. Admins on the whole account only.',
    schema: bodyOf('spaces.create'),
    offered: (acct) => mayCreateSpace(acct.principal),
    run: (_acct, args, call) => call('spaces.create', { body: args }),
  },
  {
    name: 'admin_create_docket',
    description: 'Makes a docket in a space, from a template (sdlc, crm, research, blank...), a copy of another docket, or ontology YAML, with its initial access.',
    schema: bodyOf('dockets.create'),
    offered: (acct) => acct.canAnywhere('create'),
    run: (_acct, args, call) => call('dockets.create', { body: args }),
  },
  {
    name: 'admin_update_docket',
    description: 'Renames a docket, or moves it to another space.',
    schema: z.object({ docket: z.string().min(1).max(40) }).extend(bodyOf('dockets.update').shape),
    offered: (acct) => acct.canAnywhere('settings'),
    run: (_acct, { docket, ...body }, call) => call('dockets.update', { params: { docket: String(docket) }, body }),
  },
  {
    name: 'admin_update_settings',
    description:
      "Changes a space's or a docket's settings: its models (cypher: lookups and background work; synthesis: answers and the Ask agent; null takes the place above's), " +
      "for a space what its dockets may choose from (allowed) and its slice of the account's monthly AI cap (slice_usd), and for a docket its background agents " +
      '(enrichment, cognee). Name exactly one place: space:<slug> or docket:<slug>. Only what you send changes, and everything stays within the limits of the places above.',
    schema: z
      .object({ place: z.string().regex(/^(?:space|docket):[a-z0-9-]{1,40}$/, 'space:<slug> or docket:<slug>') })
      .extend(bodyOf('spaces.settings.update').shape)
      .extend(bodyOf('dockets.settings.update').shape)
      .strict(),
    offered: (acct) => acct.canAnywhere('settings'),
    run: (_acct, { place, ...body }, call) => {
      const [kind, slug] = String(place).split(':') as ['space' | 'docket', string]
      const sent = (keys: readonly string[]) => keys.filter((key) => body[key] !== undefined)
      if (kind === 'space') {
        const wrong = sent(['enrichment', 'cognee'])
        if (wrong.length) throw new InvalidArgumentsError(`A space has no ${wrong.join(' or ')}: those are a docket's background agents.`)
        return call('spaces.settings.update', { params: { space: slug }, body })
      }
      const wrong = sent(['allowed', 'slice_usd'])
      if (wrong.length) throw new InvalidArgumentsError(`A docket has no ${wrong.join(' or ')}: those are a space's.`)
      return call('dockets.settings.update', { params: { docket: slug }, body })
    },
  },
  {
    name: 'admin_create_system_account',
    description: 'Makes a system account (for CI, an integration or a bot) and gives it access. Its tokens are issued in the app or the API, never here.',
    schema: bodyOf('system-accounts.create'),
    offered: (acct) => acct.canAnywhere('system'),
    run: (_acct, args, call) => call('system-accounts.create', { body: args }),
  },
  {
    name: 'admin_usage',
    description: 'What the account holds and how much it was used in the last 30 days.',
    schema: z.object({}),
    offered: (acct) => acct.capsAt(ACCOUNT).has('audit'),
    run: (_acct, _args, call) => call('usage.get', {}),
  },
]

function jsonSchemaOf(schema: z.ZodObject): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  return rest
}

const truthy = (value: string | null) => value === '1' || value === 'true'

export async function handleAccountMcp(event: RequestEvent): Promise<Response> {
  const runtime = getRuntime()
  const orgSlug = event.params.org ?? ''
  const resourceUrl = accountMcpUrl(runtime.origin, orgSlug)
  const base = { ip: clientAddress(event), userAgent: event.request.headers.get('user-agent'), requestId: event.locals.requestId }
  const latency = () => performance.now() - event.locals.startedAt
  const recordRefused = refusedCredentials(event, runtime, resourceUrl)

  const blocked = runtime.refusedAuth.check(base.ip ?? 'unknown')
  if (!blocked.ok) {
    return respond(429, { error: 'rate_limited', error_description: 'Too many refused credentials from this address; try again later.' }, { 'retry-after': String(blocked.retryAfterSeconds) })
  }
  // `read_only` and `admin` are the only parameters: anything named like a credential is refused, as at every address.
  if (credentialInUrl(event.url)) {
    await recordRefused('mcp.auth', 'invalid')
    return refusal(resourceUrl, { status: 400, error: 'invalid_request', description: 'Send the token in the Authorization header, never in the URL.' })
  }
  const bearer = bearerOf(event.request)
  if (!bearer) return refusal(resourceUrl, null)

  const org = /^[a-z0-9-]{1,40}$/.test(orgSlug)
    ? await runtime.router.withPlatform(async (tx) => (await tx.query<{ id: string }>("SELECT id FROM platform.orgs WHERE slug = $1 AND status = 'active'", [orgSlug])).rows[0] ?? null)
    : null
  const credential = org ? await runtime.tokens.resolveCredential(bearer) : null
  // A grant made before named connections is for its one docket's address only.
  if (!org || !credential || credential.orgId !== org.id || (credential.audience !== null && credential.audience !== resourceUrl)) {
    await recordRefused('mcp.auth', 'denied')
    return refusal(resourceUrl, { status: 401, error: 'invalid_token', description: 'This token is not valid for this account.' })
  }
  const principal: AccountPrincipal = credential

  const record = (fields: Pick<AuditEventInput, 'action' | 'outcome'> & Partial<AuditEventInput>) =>
    runtime.router.withTenant(principal.orgId, (tx: Tx) => audit(tx, { ...base, orgId: principal.orgId, actor: principal.actor, latencyMs: latency(), ...fields }))

  const raw = await event.request.text()
  let body: { message: Message } | { invalid: 'too-large' | 'not-json' | 'batch' }
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) body = { invalid: 'too-large' }
  else {
    try {
      const parsed = JSON.parse(raw) as unknown
      body = Array.isArray(parsed) ? { invalid: 'batch' } : { message: parsed as Message }
    } catch {
      body = { invalid: 'not-json' }
    }
  }
  const message = 'message' in body && isObject(body.message) ? body.message : null
  const method = message && typeof message.method === 'string' ? message.method : 'invalid'
  const params = message && isObject(message.params) ? message.params : {}
  const toolName = method === 'tools/call' && typeof params.name === 'string' ? params.name : null
  const action = `mcp.${method}${toolName ? ` ${toolName}` : ''}`.slice(0, 200)
  const args = method === 'tools/call' ? (params.arguments ?? {}) : params

  // What the owner may do on each docket now, cut by the credential: read afresh on every call.
  const readOnly = truthy(event.url.searchParams.get('read_only'))
  const access = await runtime.router.withPlatform((tx) => accessOf(tx, principal.orgId, principal.userId))
  const { workspaces, spaces } = await runtime.router.withTenant(principal.orgId, async (tx) => ({ workspaces: await listWorkspaces(tx), spaces: await listSpaces(tx) }))
  const spaceNames = new Map(spaces.map((space) => [space.id, space.name]))
  const reach: Reach[] = workspaces.flatMap((workspace) => {
    // Only the dockets the token or connection names, when it names some.
    if (principal.dockets && !principal.dockets.includes(workspace.id)) return []
    const scopes = scopesOn(access, principal, workspace.id).filter((scope) => !readOnly || READ_SCOPES.includes(scope))
    return scopes.length ? [{ id: workspace.id, slug: workspace.slug, name: workspace.name, space: spaceNames.get(workspace.spaceId) ?? '', scopes }] : []
  })

  // The management tools, opted in to: only for a caller who can manage something, never read-only.
  const user = await runtime.router.withPlatform((tx) => userById(tx, principal.userId))
  const caller: Caller | null = user
    ? { user: { id: user.id, login: user.login, name: user.name, kind: user.kind }, via: principal.via, session: null, credential: principal, actor: principal.actor }
    : null
  const wantsAdmin = truthy(event.url.searchParams.get('admin')) && !readOnly && !readsOnly(principal)
  const acct = wantsAdmin && caller && access ? await accountCaller(caller, orgSlug).catch(() => null) : null
  const admin = acct ? ADMIN_TOOLS.filter((tool) => tool.offered(acct)) : []

  if (!access || (reach.length === 0 && admin.length === 0)) {
    await record({ action: 'mcp.auth', outcome: 'denied' })
    return refusal(resourceUrl, { status: 401, error: 'invalid_token', description: 'This credential no longer grants anything in this account.' })
  }

  const inTenant = async <T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T> => {
    const keys = await runtime.keyring.forOrg(principal.orgId)
    return runtime.router.withTenant(principal.orgId, (tx) => fn({ tx, keys }))
  }
  let audited = false
  const used: Reach[] = []
  let writer: Promise<Pick<Writer, 'label' | 'principal'>> | null = null
  const writerOf = () =>
    (writer ??= runtime.router.withPlatform(async (tx) => {
      const person = await actsFor(tx, principal.userId)
      return { label: await principalLabel(tx, principal), ...(person ? { principal: person } : {}) }
    }))

  /** One docket's tools, as its pinned address builds them, for this caller. */
  const toolsOf = (docket: Reach): CloudTool[] => {
    const forDocket: Principal = { ...principal, workspaceId: docket.id }
    return cloudTools({
      orgId: principal.orgId,
      workspaceId: docket.id,
      viewer: new URL(`/o/${orgSlug}/w/${docket.slug}/graph`, runtime.origin).toString(),
      ontologyHistory: new URL(`/o/${orgSlug}/w/${docket.slug}/ontology/history`, runtime.origin).toString(),
      inTenant,
      query: runtime.query,
      assertWithinCap: async () =>
        runtime.caps.assertWithinCap(principal.orgId, await runtime.router.withPlatform((tx) => docketCapScope(tx, principal.orgId, docket.id))),
      actor: principal.actor,
      userId: principal.userId,
      writer: async () => ({ workspaceId: docket.id, actor: principal.actor, channel: 'mcp' as const, requestId: base.requestId, ...(await writerOf()) }),
      // Asked again under the publish's locks: Publish ontology changes on this docket now, cut by the credential.
      mayPublish: async () => scopesOn(await runtime.router.withPlatform((tx) => accessOf(tx, principal.orgId, principal.userId)), forDocket, docket.id).includes('ontology:write') && !readOnly,
      audited: async (fn) => {
        const value = await inTenant(async (ctx) => {
          const done = await fn(ctx)
          await audit(ctx.tx, { ...base, orgId: principal.orgId, workspaceId: docket.id, actor: principal.actor, latencyMs: latency(), action, outcome: done.outcome, args, target: done.target })
          return done.value
        })
        audited = true
        return value
      },
    })
  }

  const registry: ToolRegistry = {}
  const pinned = principal.dockets?.length === 1 ? principal.dockets[0] : null

  registry.docket_list = {
    definition: {
      name: 'docket_list',
      title: 'List dockets',
      description: 'The dockets this connection may use, with their space and what it can do in each (read, write, propose or publish ontology changes). Name one as docket on every other call.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    async call() {
      const dockets = reach.map((docket) => ({
        docket: docket.slug,
        name: docket.name,
        space: docket.space,
        can: [
          ...(docket.scopes.includes('docket:read') ? ['read'] : []),
          ...(docket.scopes.includes('docket:write') ? ['write'] : []),
          ...(docket.scopes.includes('ontology:propose') ? ['propose'] : []),
          ...(docket.scopes.includes('ontology:write') ? ['publish'] : []),
        ],
      }))
      const lines = dockets.map((docket) => `- ${docket.docket}: ${docket.name}${docket.space ? ` (${docket.space})` : ''}; can ${docket.can.join(', ')}`)
      return { content: [{ type: 'text', text: dockets.length ? `Dockets you may use:\n${lines.join('\n')}` : 'This connection reaches no docket.' }], structuredContent: { dockets } }
    },
  }

  const template = reach[0] ? toolsOf(reach[0]) : []
  const scopeOfTool = new Map<string, Scope>()
  for (const entry of template) {
    const name = entry.tool.definition.name
    const allowed = reach.filter((docket) => docket.scopes.includes(entry.scope))
    if (allowed.length === 0) continue
    scopeOfTool.set(name, entry.scope)
    const write = isWrite(entry)
    const implied = pinned !== null && allowed.some((docket) => docket.id === pinned)
    registry[name] = {
      definition: withDocket(entry.tool.definition, allowed.map((docket) => docket.slug), { write, required: !implied && (write || allowed.length > 1) }),
      async call(given) {
        const all = isObject(given) ? given : {}
        const stripped = Object.fromEntries(Object.entries(all).filter(([key]) => !(DOCKET_ARGS as readonly string[]).includes(key)))
        const choices = allowed.map((docket) => docket.slug).join(', ')
        const pick = (slug: unknown): Reach => {
          const found = allowed.find((docket) => docket.slug === slug)
          if (!found) throw new InvalidArgumentsError(`${name} cannot use docket "${String(slug)}" here; choose one of: ${choices}.`)
          return found
        }
        let targets: Reach[]
        if (all.docket !== undefined && all.dockets !== undefined) throw new InvalidArgumentsError('Name docket or dockets, not both.')
        if (all.dockets !== undefined) {
          if (write) throw new InvalidArgumentsError(`${name} writes, so it names exactly one docket: use docket.`)
          if (!Array.isArray(all.dockets) || all.dockets.length === 0 || all.dockets.length > MOST_DOCKETS) {
            throw new InvalidArgumentsError(`dockets lists 1 to ${MOST_DOCKETS} of: ${choices}.`)
          }
          targets = [...new Set(all.dockets)].map(pick)
        } else if (all.docket !== undefined) targets = [pick(all.docket)]
        else if (implied) targets = allowed.filter((docket) => docket.id === pinned)
        else if (!write && allowed.length === 1) targets = allowed
        else throw new InvalidArgumentsError(`Name the docket ${name} uses, with docket: one of ${choices}.`)

        const results: { docket: Reach; result: ToolResult }[] = []
        for (const docket of targets) {
          used.push(docket)
          const inner = toolsOf(docket).find((entry) => entry.tool.definition.name === name)
          if (!inner) throw new InvalidArgumentsError(`${name} is not offered in ${docket.slug}.`)
          const source: CanonicalSource = tenantSource(inTenant, docket.id)
          results.push({ docket, result: await inner.tool.call(stripped, { source: async () => source, viewer: null }) })
        }
        const heading = (docket: Reach) => `Docket: ${docket.slug} (${docket.name})`
        if (results.length === 1) {
          const [only] = results as [{ docket: Reach; result: ToolResult }]
          const [first, ...rest] = only.result.content
          return { ...only.result, content: [{ type: 'text', text: `${heading(only.docket)}\n${first?.text ?? ''}` }, ...rest] }
        }
        return {
          content: results.map(({ docket, result }) => ({ type: 'text' as const, text: `${heading(docket)}\n${result.content.map((part) => part.text).join('\n')}` })),
          structuredContent: { results: results.map(({ docket, result }) => ({ docket: docket.slug, isError: result.isError === true, result: result.structuredContent ?? null })) },
          ...(results.every(({ result }) => result.isError) ? { isError: true } : {}),
        }
      },
    }
  }

  let adminAudited = false
  for (const tool of admin) {
    registry[tool.name] = {
      definition: { name: tool.name, description: tool.description, inputSchema: jsonSchemaOf(tool.schema), annotations: { readOnlyHint: tool.name === 'admin_usage' } },
      async call(given) {
        const checked = tool.schema.safeParse(given ?? {})
        if (!checked.success) throw new InvalidArgumentsError(`${tool.name}: ${checked.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`).join('; ')}`)
        const run = async (id: OperationId, input: { params?: Record<string, string>; query?: Record<string, unknown>; body?: Record<string, unknown> }) => {
          const op = operation(id)
          const parse = (schema: z.ZodType | undefined, value: unknown) => {
            if (!schema) return {}
            const result = schema.safeParse(value)
            if (!result.success) throw new InvalidArgumentsError(`${tool.name}: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`)
            return result.data as Record<string, unknown>
          }
          const call: ApiCall = {
            caller: caller as Caller,
            meta: { ...base, startedAt: event.locals.startedAt, csrf: null },
            params: { acct: orgSlug, ...(input.params ?? {}) },
            query: parse(op.query, input.query ?? {}),
            body: parse(op.body, input.body ?? {}),
            audit: { orgId: principal.orgId, target: [], written: false },
            action,
          }
          try {
            const answer = await (HANDLERS[id] as NonNullable<(typeof HANDLERS)[string]>)(call)
            await recordCall(call, 'ok')
            return answer.body
          } catch (cause) {
            if (cause instanceof InvalidArgumentsError) throw cause
            const error = errorOf(cause)
            await recordCall(call, error.code === 'server_error' ? 'error' : error.code === 'invalid_request' ? 'invalid' : 'denied').catch(() => undefined)
            throw error
          } finally {
            adminAudited = true
          }
        }
        try {
          const value = await tool.run(acct as AccountCaller, checked.data, run)
          return { content: [{ type: 'text', text: JSON.stringify(value ?? { ok: true }, null, 2) }], structuredContent: (value ?? { ok: true }) as object }
        } catch (cause) {
          if (cause instanceof InvalidArgumentsError) throw cause
          const error = errorOf(cause)
          return failedResult(error.code === 'server_error' ? 'The server failed to do that.' : error.message)
        }
      },
    }
  }

  const writeTool = (name: string) => {
    const entry = template.find((each) => each.tool.definition.name === name)
    return (entry !== undefined && isWrite(entry)) || (name.startsWith('admin_') && registry[name]?.definition.annotations?.readOnlyHint !== true)
  }
  const limit = mcpRateLimit<{ tokenId: string; orgId: string }>({
    limiter: runtime.limiter,
    isWriteTool: writeTool,
    audit: async ({ refusal: refused }) => {
      await record({ action, outcome: 'denied', args, target: [`rate-limit:${refused.limit.what ?? 'calls'}-per-${refused.limit.scope}`] })
    },
  })
  const limited = await limit({ tokenId: principal.tokenId, orgId: principal.orgId }, { id: jsonRpcId(message?.id), method, params })
  if (limited) return limited

  const version = event.request.headers.get('mcp-protocol-version')
  if (version && !PROTOCOL_VERSIONS.includes(version)) {
    await record({ action: 'mcp.protocol', outcome: 'invalid' })
    return respond(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version ${version}; this server speaks ${PROTOCOL_VERSIONS.join(', ')}.` } })
  }
  if ('invalid' in body) {
    await record({ action: 'mcp.request', outcome: 'invalid' })
    if (body.invalid === 'too-large') return respond(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'The request is too large.' } })
    if (body.invalid === 'not-json') return respond(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'The body is not JSON.' } })
    return respond(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one JSON-RPC message per POST.' } })
  }

  // A docket tool no docket lets this caller use is refused as at the pinned address: 403 insufficient_scope.
  if (toolName && !registry[toolName]) {
    const needed = template.find((entry) => entry.tool.definition.name === toolName)?.scope
    if (needed) {
      await record({ action, outcome: 'denied', args })
      return refusal(resourceUrl, { status: 403, error: 'insufficient_scope', scope: needed, description: `This needs the ${needed} scope on a docket.` })
    }
  }

  // Each tool reads the source of the docket its call names; the server's own is never asked.
  const server = createMcpServer({ source: tenantSource(inTenant, reach[0]?.id ?? ''), tools: registry, appFile: process.env.DOCKET_MCP_APP })
  let response: JsonRpcResponse | null
  try {
    response = (await server.handle(body.message)) as JsonRpcResponse | null
  } catch (cause) {
    console.error(`[${event.locals.requestId}] mcp: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`)
    response = { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32603, message: 'The server failed to answer.' } }
  }
  if (method === 'initialize' && response?.result) {
    response = { ...response, result: { ...response.result, instructions: ACCOUNT_INSTRUCTIONS, serverInfo: { name: 'docket-cloud', title: 'Docket Cloud', version: '0.1.0' } } }
  }
  if (!audited && !adminAudited) {
    const one = used.length === 1 ? used[0] : undefined
    await record({ action, outcome: outcomeOf(response), args, target: used.map((docket) => `docket:${docket.slug}`), ...(one ? { workspaceId: one.id } : {}) })
  }
  if (!response) return respond(202, null)
  return respond(200, response)
}

