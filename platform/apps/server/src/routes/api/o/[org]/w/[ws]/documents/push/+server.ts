// SPDX-License-Identifier: AGPL-3.0-only
import { actsFor, principalLabel } from '@docket/platform-auth'
import { checkoutProblem, pushDocuments, type PushInput } from '@docket/platform-canonical-store'

import { CliError, cliJson, handleCli } from '$lib/server/cli-api'

import type { RequestHandler } from './$types'

const isFile = (value: unknown): value is { path: string; raw: string } =>
  typeof value === 'object' && value !== null && typeof (value as { path?: unknown }).path === 'string' && typeof (value as { raw?: unknown }).raw === 'string'

/**
 * `docket cloud push`: a checkout's files as `cli` documents, validated as
 * one and applied in one transaction with its audit and ingest events.
 * Refused by the validator, it answers 200 with `ok: false`: nothing applied.
 */
export const POST: RequestHandler = (event) =>
  handleCli(event, { action: 'documents.push', scope: 'docket:write', write: true }, async (call) => {
    const { runtime, principal } = call
    const body = await call.json()
    const problem = checkoutProblem(body.checkout)
    if (problem) throw new CliError(400, 'invalid_request', problem)
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw new CliError(400, 'invalid_request', 'dryRun is true or false.')
    const upsert = body.upsert ?? []
    if (!Array.isArray(upsert) || !upsert.every(isFile)) throw new CliError(400, 'invalid_request', 'upsert is a list of { path, raw } strings.')
    const remove = body.remove ?? []
    if (!Array.isArray(remove) || !remove.every((path) => typeof path === 'string')) throw new CliError(400, 'invalid_request', 'remove is a list of paths.')
    const input: PushInput = { checkout: body.checkout as string, upsert: upsert.map(({ path, raw }) => ({ path, raw })), remove }
    const dryRun = body.dryRun === true

    const { label, person } = await runtime.router.withPlatform(async (tx) => ({ label: await principalLabel(tx, principal), person: await actsFor(tx, principal.userId) }))
    const writer = { workspaceId: principal.workspaceId, actor: principal.actor, label, channel: 'cli' as const, requestId: event.locals.requestId, ...(person ? { principal: person } : {}) }
    const result = await call.inTenant(async (ctx) => {
      const pushed = await pushDocuments(ctx, writer, input, { dryRun })
      await call.audit(ctx.tx, {
        outcome: pushed.ok ? 'ok' : 'invalid',
        target: [input.checkout],
        args: { checkout: input.checkout, dryRun, upsert: input.upsert.map((file) => file.path), remove: input.remove },
      })
      return pushed
    })
    const { ok, created, updated, unchanged, removed, diagnostics } = result
    return cliJson(200, { ok, dryRun, created, updated, unchanged, removed, diagnostics })
  })
