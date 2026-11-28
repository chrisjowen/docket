import { z } from 'zod'

import { OPERATIONS, type Operation } from './operations.js'
import { ApiError, ERROR_STATUS } from './schemas.js'

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>
const input = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>

const SECURITY: Record<string, Record<string, string[]>[]> = {
  session: [{ session: [] }],
  token: [{ bearer: [] }],
  oauth: [{ oauth: [] }],
}

function parameters(operation: Operation) {
  const out: Record<string, unknown>[] = []
  for (const [where, schema] of [
    ['path', operation.params],
    ['query', operation.query],
  ] as const) {
    if (!schema) continue
    const shape = input(schema) as { properties?: Record<string, unknown>; required?: string[] }
    for (const [name, property] of Object.entries(shape.properties ?? {})) {
      out.push({ name, in: where, required: where === 'path' || (shape.required ?? []).includes(name), schema: property })
    }
  }
  return out
}

/**
 * The OpenAPI 3.1 document of `/api/v1`, generated from `OPERATIONS`: each
 * operation's credentials (`security`), the capability it needs
 * (`x-docket-needs`), whether a read-only credential may call it
 * (`x-docket-read-only`), its schemas, and every error it answers with.
 */
export function openApiDocument(origin = 'https://docket.example') {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const operation of OPERATIONS as readonly Operation[]) {
    const errors = Object.fromEntries(
      [...new Set(operation.errors.map((code) => ERROR_STATUS[code]))].map((status) => [
        String(status),
        {
          description: operation.errors.filter((code) => ERROR_STATUS[code] === status).join(', '),
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
      ]),
    )
    const success = operation.stream
      ? { description: 'A stream of events', content: { [operation.stream.contentType]: { schema: json(operation.stream.event) } } }
      : operation.response
        ? { description: 'OK', content: { 'application/json': { schema: json(operation.response) } } }
        : { description: 'No content' }
    ;(paths[operation.path] ??= {})[operation.method.toLowerCase()] = {
      operationId: operation.id,
      summary: operation.summary,
      tags: [operation.tag],
      security: operation.auth.flatMap((credential) => SECURITY[credential] ?? []),
      'x-docket-needs': operation.needs,
      'x-docket-read-only': operation.readOnly,
      ...(operation.mcpTool ? { 'x-docket-mcp-tool': operation.mcpTool } : {}),
      parameters: parameters(operation),
      ...(operation.body ? { requestBody: { required: true, content: { 'application/json': { schema: input(operation.body) } } } } : {}),
      responses: { [String(operation.status)]: success, ...errors },
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Docket API',
      version: '1',
      description:
        'A call needs the same capability as the button in the app, held by whoever the credential acts as, on the place it names. ' +
        'A token or OAuth connection acts as its owner, narrowed to read-only and/or to some dockets. A browser session sends its CSRF token ' +
        '(GET /api/v1/me) as X-CSRF-Token on every call that is not a GET.',
    },
    servers: [{ url: origin }],
    paths,
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'docket_session', description: 'A browser session; mutations also send X-CSRF-Token.' },
        bearer: { type: 'http', scheme: 'bearer', description: 'A personal (dkt_pat_) or system account (dkt_sys_) API token.' },
        oauth: {
          type: 'oauth2',
          description: 'An access token from a named OAuth connection (RFC 8707 resource: the account or a docket MCP URL).',
          flows: { authorizationCode: { authorizationUrl: `${origin}/oauth/authorize`, tokenUrl: `${origin}/oauth/token`, scopes: {} } },
        },
      },
      schemas: { ApiError: json(ApiError) },
    },
  }
}
