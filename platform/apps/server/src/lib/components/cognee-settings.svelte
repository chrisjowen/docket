<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { BrainCog } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  interface Props {
    cognee: {
      available: boolean
      enabled: boolean
      floor: number
      monthlyLimitUsd: number
      spentUsd: number
      capUsd: number
    }
    csrf: string | null
    canManage: boolean
    ws: { acct: string; docket: string }
    problem?: string | undefined
    flash?: string | undefined
  }

  let { cognee, csrf, canManage, ws, problem, flash }: Props = $props()
</script>

<section class="card section stack" aria-labelledby="cognee-heading" data-testid="cognee">
  <h2 id="cognee-heading"><BrainCog size={16} aria-hidden="true" /> cognee</h2>
  <p class="muted">
    Off unless you turn it on. An extra store beside the graph and the search index: the worker files each resource into
    <a href="https://www.cognee.ai/" rel="noreferrer" target="_blank">cognee</a>, which cognifies it into a knowledge graph
    of its own, and search asks it alongside the others. Cognify runs the org's AI over every new or changed resource, so it
    spends from this setting's own monthly limit inside the org's cap; when either is spent, cognee waits and says so on the
    <a href={resolve('/a/[acct]/d/[docket]/settings/sync', ws)}>Sync</a> tab, and writes and search carry on without it. Search keeps
    only what cognee finds at least as similar to the question as the floor, so it can answer with nothing.
  </p>

  {#if problem}<p class="alert" role="alert">{problem}</p>{/if}
  {#if flash}<p class="flash" role="status">{flash}</p>{/if}

  {#if !cognee.available}
    <p class="muted fine" data-testid="cognee-unavailable">cognee does not run on this server{cognee.enabled ? '; it stays off here until it does' : ''}.</p>
  {/if}

  {#if canManage}
    <form method="POST" action="?/cognee" class="stack">
      <Csrf token={csrf} />
      <label class="toggle">
        <input type="checkbox" name="enabled" checked={cognee.enabled} disabled={!cognee.available && !cognee.enabled} />
        Project this docket into cognee
      </label>
      <div class="row">
        <label>
          Search floor (similarity, 0 to 1)
          <input name="floor" type="number" min="0" max="1" step="0.01" value={cognee.floor} required />
        </label>
        <label>
          Monthly AI limit for cognify (US dollars, at most the org's ${cognee.capUsd.toFixed(2)})
          <input name="limit" type="number" min="0" max={cognee.capUsd} step="0.5" value={cognee.monthlyLimitUsd} required />
        </label>
      </div>
      <p class="muted fine">
        0.58 is where docket's search evaluation found cognee stopped answering questions about people the documents never
        name; lower finds more and abstains less.
      </p>
      <div><button class="button primary" type="submit">Save</button></div>
    </form>
  {/if}

  <dl>
    <dt>Status</dt>
    <dd data-testid="cognee-status">{cognee.enabled ? `On, floor ${cognee.floor}` : 'Off'}</dd>
    <dt>AI this month</dt>
    <dd>${cognee.spentUsd.toFixed(2)} of ${cognee.monthlyLimitUsd.toFixed(2)}</dd>
  </dl>
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
    gap: 0.4rem 1.25rem;
    margin: 0;
  }
  dt {
    color: var(--muted-foreground);
  }
  dd {
    margin: 0;
  }
</style>
