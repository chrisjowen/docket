<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { Sparkles } from '@lucide/svelte'
  import { onMount } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'

  interface RunSummary {
    found: Record<string, number>
    written: Record<string, number>
    skipped: { known: number; rejected: number; undecided: number; refused: number; overRunLimit: number }
    orphansRetired: number
    aiCalls: number
    aiStopped?: 'limit' | 'cap' | 'off'
  }

  interface Run {
    id: string
    trigger: 'schedule' | 'manual'
    requestedBy: string | null
    status: 'running' | 'ok' | 'limited' | 'failed'
    startedAt: string
    finishedAt: string | null
    summary: RunSummary | null
    costUsd: number
    error: string | null
    retiredAt: string | null
    retiredBy: string | null
    live: number
  }

  interface Props {
    enrichment: {
      enabled: boolean
      schedule: 'nightly' | 'weekly'
      monthlyLimitUsd: number
      nextRunAt: string | null
      requestedAt: string | null
      canRunNow: boolean
      spentUsd: number
      capUsd: number
      runs: Run[]
    }
    csrf: string | null
    canManage: boolean
    ws: { acct: string; docket: string }
    problem?: string | undefined
    flash?: string | undefined
  }

  let { enrichment, csrf, canManage, ws, problem, flash }: Props = $props()

  const KINDS: Record<string, [string, string]> = {
    link: ['link', 'links'],
    owner: ['owner', 'owners'],
    duplicate: ['duplicate', 'duplicates'],
    contradiction: ['contradiction', 'contradictions'],
  }
  const STATUS: Record<Run['status'], string> = { running: 'running', ok: 'finished', limited: 'AI limit reached', failed: 'failed' }
  const AI_STOPPED: Record<NonNullable<RunSummary['aiStopped']>, string> = {
    limit: "AI review stopped at this job's monthly limit",
    cap: "AI review stopped at the org's monthly cap",
    off: 'AI is off here, so only what the rules decide alone was written',
  }

  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const total = (counts: Record<string, number> | undefined) => Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0)
  const byKind = (counts: Record<string, number>) =>
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${n} ${KINDS[kind]?.[n === 1 ? 0 : 1] ?? kind}`)
      .join(', ')

  /** What a run did, in a few sentences. */
  function describe(summary: RunSummary): string {
    const written = total(summary.written)
    const { known, rejected, undecided, refused, overRunLimit } = summary.skipped
    return [
      `Wrote ${written}${written ? ` (${byKind(summary.written)})` : ''} of ${total(summary.found)} found.`,
      known ? `${known} inferred before.` : '',
      rejected ? `${rejected} rejected in review.` : '',
      undecided ? `${undecided} left open.` : '',
      refused ? `${refused} refused by the ontology check.` : '',
      overRunLimit ? `${overRunLimit} left for the next run.` : '',
      summary.orphansRetired ? `Retired ${summary.orphansRetired} whose resource is gone.` : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  const last = $derived(enrichment.runs[0])
  // While a run is asked for or under way, keep the summary current.
  const waiting = $derived(enrichment.requestedAt !== null || last?.status === 'running')
  onMount(() => {
    const timer = setInterval(() => {
      if (waiting && document.visibilityState === 'visible') void invalidateAll()
    }, 3_000)
    return () => clearInterval(timer)
  })
</script>

<section class="card section stack" aria-labelledby="enrichment-heading" data-testid="enrichment">
  <h2 id="enrichment-heading"><Sparkles size={16} aria-hidden="true" /> Background enrichment</h2>
  <p class="muted">
    Off unless you turn it on. On a schedule it reads every document and writes what they imply but never state: links named
    in descriptions, attributes or shared names, owners everything around a resource agrees on, duplicates, and where two
    duplicates disagree. Each is a document of its own under <span class="mono">.docket/~inferred/</span>, with
    <span class="mono">inferred</span> evidence giving its reasoning and citing where it was read. What the rules leave open
    goes to the org's AI, within this job's own monthly limit inside the org's cap. Nothing is inferred twice, so what you
    retire stays retired.
  </p>

  {#if problem}<p class="alert" role="alert">{problem}</p>{/if}
  {#if flash}<p class="flash" role="status">{flash}</p>{/if}

  {#if canManage}
    <form method="POST" action="?/enrichment" class="stack">
      <Csrf token={csrf} />
      <label class="toggle">
        <input type="checkbox" name="enabled" checked={enrichment.enabled} />
        Run background enrichment for this docket
      </label>
      <div class="row">
        <label>
          Schedule
          <select name="schedule" value={enrichment.schedule}>
            <option value="nightly">Nightly (02:00 UTC)</option>
            <option value="weekly">Weekly (Sundays, 02:00 UTC)</option>
          </select>
        </label>
        <label>
          Monthly AI limit (US dollars, at most the org's ${enrichment.capUsd.toFixed(2)})
          <input name="limit" type="number" min="0" max={enrichment.capUsd} step="0.5" value={enrichment.monthlyLimitUsd} required />
        </label>
      </div>
      {#if !enrichment.enabled}
        <p class="muted fine">
          Turning it on adds the <span class="mono">inferred</span> evidence source and the
          <span class="mono">duplicate_of</span> and <span class="mono">contradicts</span> relationships to the ontology, if it
          lacks them, as a version of its own.
        </p>
      {/if}
      <div><button class="button primary" type="submit">Save</button></div>
    </form>
  {/if}

  <dl>
    <dt>Status</dt>
    <dd data-testid="enrichment-status">
      {#if enrichment.enabled}
        On, {enrichment.schedule}{#if enrichment.requestedAt}; a run is asked for{:else if enrichment.nextRunAt}; next run {when(enrichment.nextRunAt)}{/if}
      {:else}
        Off
      {/if}
    </dd>
    <dt>AI this month</dt>
    <dd>${enrichment.spentUsd.toFixed(2)} of ${enrichment.monthlyLimitUsd.toFixed(2)}</dd>
  </dl>

  {#if enrichment.canRunNow && enrichment.enabled}
    <form method="POST" action="?/runEnrichment" use:enhance>
      <Csrf token={csrf} />
      <button class="button small" type="submit" disabled={waiting}>{waiting ? 'Running…' : 'Run now'}</button>
    </form>
  {/if}

  {#if last}
    <div class="runs" data-testid="enrichment-runs">
      <h3>Recent runs</h3>
      <ol>
        {#each enrichment.runs as run (run.id)}
          <li class="run" data-testid="enrichment-run" data-status={run.status}>
            <header>
              <span class={`badge ${run.status === 'ok' ? 'safe' : run.status === 'failed' ? 'invalid' : 'narrowing'}`}>{STATUS[run.status]}</span>
              <time datetime={run.startedAt}>{when(run.startedAt)}</time>
              <span class="muted small">{run.trigger === 'manual' ? `asked for by ${run.requestedBy ?? 'someone'}` : 'scheduled'}{#if run.costUsd > 0} · ${run.costUsd.toFixed(4)} of AI{/if}</span>
            </header>
            {#if run.summary}
              <p data-testid="enrichment-summary">{describe(run.summary)}</p>
              {#if run.summary.aiStopped && run.summary.skipped.undecided}<p class="muted small">{AI_STOPPED[run.summary.aiStopped]}.</p>{/if}
            {/if}
            {#if run.error}<p class="alert small">{run.error}</p>{/if}
            {#if run.retiredAt}
              <p class="muted small">Retired by {run.retiredBy} · {when(run.retiredAt)}</p>
            {:else if run.live > 0}
              <div class="actions">
                <a class="small" href="{resolve('/a/[acct]/d/[docket]/activity', ws)}?channel=enrichment">See it in the activity log</a>
                {#if canManage && run.status !== 'running'}
                  <form method="POST" action="?/retireRun" use:enhance>
                    <Csrf token={csrf} />
                    <input type="hidden" name="run" value={run.id} />
                    <button class="button small" type="submit">Retire the {run.live} it added</button>
                  </form>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    </div>
  {/if}
</section>

<style>
  .section {
    max-width: 40rem;
    padding: 1.25rem;
    margin-top: 1rem;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    font-size: 1.25rem;
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }
  p {
    margin: 0;
  }
  .fine {
    font-size: 0.8125rem;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
  }
  .row label {
    display: grid;
    gap: 0.3rem;
    flex: 1 1 14rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.5rem 1.25rem;
    margin: 0;
  }
  dt {
    color: var(--muted-foreground);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  ol {
    display: grid;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .run {
    display: grid;
    gap: 0.35rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .run header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.6rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }
</style>
