// SPDX-License-Identifier: AGPL-3.0-only
import { SettingsError, actorMonthSpend, monthOf, placeAiSettings, resolveAiSettings, saveAiSettings } from '@docket/platform-ai'
import { mcpResourceUrl, revokeWorkspaceCredentials } from '@docket/platform-auth'
import {
  CogneeSettingsError,
  WorkspaceError,
  cogneeAiActor,
  cogneeSettings,
  deleteWorkspace,
  saveCogneeSettings,
  spaceById,
} from '@docket/platform-canonical-store'
import {
  EnrichmentSettingsError,
  NoOntology,
  enrichmentAiActor,
  enrichmentSettings,
  ensureEnrichmentOntology,
  isSchedule,
  recentRuns,
  requestRun,
  retireRun,
  runById,
  saveSettings,
} from '@docket/platform-enrichment'
import { dropRoutes } from '@docket/platform-github'
import { OntologyBreakingChange, OntologyNarrowingChange, StaleDraft, TemplateError, VersionNotFound, saveOrgTemplate } from '@docket/platform-ontology-service'
import { ACCOUNT } from '@docket/platform-tenancy'
import { error, fail, redirect } from '@sveltejs/kit'

import { authorise, authoriseOwner, recordAudit, requireUser } from '$lib/server/request'
import { getRuntime } from '$lib/server/runtime'
import { modelSlots, modelsFrom } from '$lib/server/place-settings'
import { actorNames, docketAccess, inWorkspace, publisherOf } from '$lib/server/workspace'

import type { Actions, PageServerLoad } from './$types'

/**
 * The workspace's settings: what it is, its background enrichment (its
 * settings, what its AI review has spent this month, its recent runs),
 * cognee, the optional projection (on or off, its search floor, what its
 * cognify has spent this month), and its deletion. Everyone who reads the
 * workspace sees them; only the owner runs enrichment now, and whoever may
 * change settings here the rest of the enrichment and cognee. Who may publish
 * the ontology, in the app or over MCP, is on the Access tab: a capability,
 * given person by person.
 */
export const load: PageServerLoad = async (event) => {
  const { router, caps, cognee: cogneeRuns } = getRuntime()
  const read = await inWorkspace(event, async ({ access, workspace, ctx }) => {
    authorise(access, 'read')
    return {
      access,
      workspaceId: workspace.id,
      owner: access.owner,
      settings: await enrichmentSettings(ctx.tx, workspace.id),
      runs: await recentRuns(ctx.tx, workspace.id, 5),
      cognee: await cogneeSettings(ctx.tx, workspace.id),
      space: (await spaceById(ctx.tx, workspace.spaceId))?.name ?? 'its space',
    }
  })
  const { access, settings, runs } = read
  const month = monthOf(new Date())
  const [cap, spentUsd, cogneeSpentUsd, name, ai] = await Promise.all([
    caps.status(access.org.id),
    router.withPlatform((tx) => actorMonthSpend(tx, access.org.id, enrichmentAiActor(read.workspaceId), month)),
    router.withPlatform((tx) => actorMonthSpend(tx, access.org.id, cogneeAiActor(read.workspaceId), month)),
    actorNames(access),
    router.withPlatform(async (tx) => {
      const resolved = await resolveAiSettings(tx, access.org.id, { docketId: read.workspaceId })
      return { resolved, own: await placeAiSettings(tx, access.org.id, { kind: 'docket', id: read.workspaceId }) }
    }),
  ])
  return {
    /** The docket's models (tenancy v2 §5): its own choice, or its space's; whoever may change settings here changes them. */
    models: {
      slots: modelSlots(ai.resolved, ai.own),
      space: read.space,
      key: ai.resolved.key.from === 'space' ? { provider: ai.resolved.key.provider, hint: ai.resolved.key.hint } : null,
      canChange: access.caps.has('settings'),
    },
    cognee: {
      available: cogneeRuns,
      enabled: read.cognee.enabled,
      floor: read.cognee.floor,
      monthlyLimitUsd: read.cognee.monthlyLimitUsd,
      spentUsd: cogneeSpentUsd,
      capUsd: cap.capUsd,
    },
    enrichment: {
      enabled: settings.enabled,
      schedule: settings.schedule,
      monthlyLimitUsd: settings.monthlyLimitUsd,
      nextRunAt: settings.nextRunAt?.toISOString() ?? null,
      requestedAt: settings.requestedAt?.toISOString() ?? null,
      canRunNow: read.owner,
      spentUsd,
      capUsd: cap.capUsd,
      runs: runs.map((run) => ({
        id: run.id,
        trigger: run.trigger,
        requestedBy: run.requestedBy ? name(run.requestedBy) : null,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        summary: run.summary,
        costUsd: run.costUsd,
        error: run.error,
        retiredAt: run.retiredAt?.toISOString() ?? null,
        retiredBy: run.retiredBy ? name(run.retiredBy) : null,
        live: run.live,
      })),
    },
  }
}

/** A settings problem the person can fix, as the page shows it; anything else is thrown. */
function problemOf(caught: unknown): string | null {
  if (caught instanceof EnrichmentSettingsError || caught instanceof NoOntology) return caught.message
  if (caught instanceof StaleDraft) return 'The ontology changed while this was saved: try again.'
  if (caught instanceof OntologyBreakingChange || caught instanceof OntologyNarrowingChange) {
    return 'Adding what enrichment needs to the ontology would change how existing documents validate: publish it from the Ontology tab instead.'
  }
  return null
}

export const actions: Actions = {
  /** The docket's own models, within what its space and the account allow; empty takes its space's. */
  models: async (event) => {
    const user = requireUser(event)
    const { access, workspace } = await docketAccess(event)
    if (!access.caps.has('settings')) error(403, 'You do not have access to that.')
    const { models } = modelsFrom(await event.request.formData())
    const { router } = getRuntime()
    try {
      await router.withPlatform(async (tx) => {
        const saved = await saveAiSettings(tx, { orgId: access.org.id, place: { kind: 'docket', id: workspace.id }, models, by: user.id })
        await router.enterTenant(tx, access.org.id)
        await recordAudit(tx, event, {
          action: 'docket.models',
          orgId: access.org.id,
          workspaceId: workspace.id,
          args: { before: saved.before.models, after: saved.after.models },
        })
      })
    } catch (caught) {
      if (caught instanceof SettingsError) return fail(400, { modelsProblem: caught.message })
      throw caught
    }
    return { modelsFlash: `Saved ${workspace.name}'s models.` }
  },

  /**
   * Saves the docket's published ontology - its types, relationships, sources
   * and policies, never its documents - as one of the org's templates, which
   * New docket then offers. Whoever may change the account's settings.
   */
  saveTemplate: async (event) => {
    const form = await event.request.formData()
    try {
      const saved = await inWorkspace(event, async ({ access, workspace, ctx }) => {
        if (!access.capsAt(ACCOUNT).has('settings')) error(403, 'You do not have access to that.')
        const template = await saveOrgTemplate(ctx.tx, {
          name: String(form.get('name') ?? ''),
          description: String(form.get('description') ?? ''),
          tags: String(form.get('tags') ?? ''),
          fromWorkspaceId: workspace.id,
          actor: publisherOf(event).actor,
        })
        await recordAudit(ctx.tx, event, {
          action: 'template.save',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [`template:${template.id}`],
          args: { name: template.name },
        })
        return template
      })
      return { templateFlash: `Saved as the "${saved.name}" template. New docket offers it now.` }
    } catch (caught) {
      if (caught instanceof TemplateError || caught instanceof VersionNotFound) return fail(400, { templateProblem: caught.message })
      throw caught
    }
  },

  /**
   * Turns enrichment on or off and sets its schedule and monthly AI limit
   * (at most the org's cap). Turning it on first publishes what it writes
   * with onto the ontology, if the head lacks it: the `inferred` evidence
   * source and the `duplicate_of` and `contradicts` relationships.
   */
  enrichment: async (event) => {
    const user = requireUser(event)
    const form = await event.request.formData()
    const enabled = form.get('enabled') === 'on'
    const schedule = String(form.get('schedule') ?? '')
    const limit = Number(String(form.get('limit') ?? '').trim())
    if (!isSchedule(schedule)) return fail(400, { enrichmentProblem: 'Choose nightly or weekly.' })
    const { caps } = getRuntime()
    try {
      const saved = await inWorkspace(event, async ({ access, workspace, ctx }) => {
        if (!access.capsAt(ACCOUNT).has('settings')) error(403, 'You do not have access to that.')
        const capUsd = (await caps.status(access.org.id)).capUsd
        const published = enabled ? await ensureEnrichmentOntology(ctx, workspace.id, { ...publisherOf(event), requestId: event.locals.requestId }) : null
        await saveSettings(ctx.tx, workspace.id, { enabled, schedule, monthlyLimitUsd: limit, capUsd, by: `user:${user.id}` })
        await recordAudit(ctx.tx, event, {
          action: 'enrichment.settings',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [workspace.slug],
          args: { enabled, schedule, limit, ontology: published?.number ?? null },
        })
        return published
      })
      const state = enabled ? `On, ${schedule}, up to $${limit.toFixed(2)} of AI a month.` : 'Off.'
      return { enrichmentFlash: saved ? `${state} Published ontology v${saved.number} with ${saved.added.join(', ')}.` : `Saved. ${state}` }
    } catch (caught) {
      const problem = problemOf(caught)
      if (problem) return fail(400, { enrichmentProblem: problem })
      throw caught
    }
  },

  /**
   * Turns cognee on or off for the workspace and sets its search floor and
   * cognify's monthly AI limit (at most the org's cap), for owners and admins.
   * It turns on only where a cognee service runs; turning it off has the
   * worker clear what it filed.
   */
  cognee: async (event) => {
    const user = requireUser(event)
    const form = await event.request.formData()
    const enabled = form.get('enabled') === 'on'
    const floor = Number(String(form.get('floor') ?? '').trim())
    const limit = Number(String(form.get('limit') ?? '').trim())
    const { caps, cognee: cogneeRuns } = getRuntime()
    if (enabled && !cogneeRuns) return fail(400, { cogneeProblem: 'cognee does not run on this server, so it cannot be turned on.' })
    try {
      await inWorkspace(event, async ({ access, workspace, ctx }) => {
        authorise(access, 'settings')
        const capUsd = (await caps.status(access.org.id)).capUsd
        await saveCogneeSettings(ctx.tx, workspace.id, { enabled, floor, monthlyLimitUsd: limit, capUsd, by: `user:${user.id}` })
        await recordAudit(ctx.tx, event, {
          action: 'cognee.settings',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [workspace.slug],
          args: { enabled, floor, limit },
        })
      })
    } catch (caught) {
      if (caught instanceof CogneeSettingsError) return fail(400, { cogneeProblem: caught.message })
      throw caught
    }
    return {
      cogneeFlash: enabled
        ? `On: the worker files this docket into cognee within a minute, cognifying with up to $${limit.toFixed(2)} of AI a month; search keeps what is at least ${floor} similar.`
        : 'Off: search no longer asks cognee, and the worker clears what it filed.',
    }
  },

  /** Asks the worker to run enrichment now, ahead of its schedule: the org's owner only. Its review counts against the same monthly limit. */
  runEnrichment: async (event) => {
    const user = requireUser(event)
    try {
      await inWorkspace(event, async ({ access, workspace, ctx }) => {
        authoriseOwner(access)
        await requestRun(ctx.tx, workspace.id, `user:${user.id}`)
        await recordAudit(ctx.tx, event, { action: 'enrichment.request', orgId: access.org.id, workspaceId: workspace.id, target: [workspace.slug] })
      })
    } catch (caught) {
      const problem = problemOf(caught)
      if (problem) return fail(400, { enrichmentProblem: problem })
      throw caught
    }
    return { enrichmentFlash: 'Asked for a run: it starts within a minute.' }
  },

  /** Retires everything one run wrote that is still live. No later run writes any of it again. */
  retireRun: async (event) => {
    const user = requireUser(event)
    const runId = String((await event.request.formData()).get('run') ?? '')
    let outcome
    try {
      outcome = await inWorkspace(event, async ({ access, workspace, ctx }) => {
        authorise(access, 'settings')
        const run = await runById(ctx.tx, workspace.id, runId)
        if (!run) return null
        const { retired } = await retireRun(ctx, {
          workspaceId: workspace.id,
          runId: run.id,
          actor: `user:${user.id}`,
          label: user.login,
          requestId: event.locals.requestId,
        })
        await recordAudit(ctx.tx, event, {
          action: 'enrichment.retire',
          orgId: access.org.id,
          workspaceId: workspace.id,
          target: [run.id],
          args: { retired },
        })
        return retired
      })
    } catch (caught) {
      const problem = problemOf(caught)
      if (problem) return fail(400, { enrichmentProblem: problem })
      throw caught
    }
    if (outcome === null) return fail(404, { enrichmentProblem: 'No such run.' })
    return { enrichmentFlash: `Retired ${outcome} inferred ${outcome === 1 ? 'document' : 'documents'}.` }
  },

  /**
   * Deletes the workspace (§4), for owners and admins, once its slug is typed
   * to confirm: its documents, ontology and repo connections go in one
   * transaction with the audit event. Its tokens, OAuth grants and repo
   * webhook routes are revoked before that transaction commits, so a failed
   * revocation keeps the workspace rather than leaving live credentials for
   * its address; the worker clears its projections from Neo4j and Qdrant.
   */
  delete: async (event) => {
    const user = requireUser(event)
    const confirm = String((await event.request.formData()).get('confirm') ?? '').trim()
    const runtime = getRuntime()
    const deleted = await inWorkspace(event, async ({ access, workspace, ctx }) => {
      authorise(access, 'delete')
      if (confirm !== workspace.slug) return fail(400, { problem: `Type ${workspace.slug} to delete this docket.` })
      const { connections } = await deleteWorkspace(ctx, { workspaceId: workspace.id, deletedBy: `user:${user.id}` })
      await recordAudit(ctx.tx, event, {
        action: 'workspace.delete',
        orgId: access.org.id,
        workspaceId: workspace.id,
        target: [workspace.slug],
      })
      await runtime.router.withPlatform(async (tx) => {
        await revokeWorkspaceCredentials(tx, {
          orgId: access.org.id,
          workspaceId: workspace.id,
          resource: mcpResourceUrl(runtime.origin, access.org.slug, workspace.slug),
          by: user.id,
        })
        await dropRoutes(tx, { orgId: access.org.id, connectionIds: connections })
      })
      return { org: access.org, workspace }
    })
    if (!('workspace' in deleted)) return deleted
    redirect(303, `/a/${deleted.org.slug}?deleted=${encodeURIComponent(deleted.workspace.slug)}`)
  },
}
