<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'

  import Csrf from '$lib/components/csrf.svelte'
  import ModelSlots from '$lib/components/model-slots.svelte'
  import OrgSettingsTabs from '$lib/components/org-settings-tabs.svelte'

  let { data, form } = $props()
</script>

<svelte:head>
  <title>Settings · {data.org.name}</title>
</svelte:head>

<h1>Settings</h1>
<OrgSettingsTabs org={data.org.slug} active="ai" />
<p class="muted lede">Changes are recorded in the audit log.</p>

{#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}

<form method="POST" action="?/ai" class="card section stack">
  <Csrf token={data.csrf} />
  <h2>AI</h2>
  <p class="muted">
    AI writes Cypher from questions and synthesises answers, through OpenRouter on {data.org.name}'s own key, whose credit limit
    is this cap. Search never uses it, so search keeps working when the budget is spent. Owners are warned at 80%.
    This month ({data.ai.month}): <strong>${data.ai.spentUsd.toFixed(2)}</strong> spent.
  </p>
  {#if data.owner}
    <label>
      Monthly cap (US dollars, at most ${data.maxCapUsd})
      <input name="cap" type="number" min="0" max={data.maxCapUsd} step="1" value={data.ai.capUsd} required />
    </label>
  {:else}
    <p class="muted">Monthly cap: <strong>${data.ai.capUsd.toFixed(2)}</strong>. Only an owner of the account changes it.</p>
  {/if}
  <ModelSlots slots={data.models} required limitLabel="Spaces and dockets may choose from" />
  <p class="muted fine">Every request asks OpenRouter for providers that neither train on prompts nor retain them.</p>
  <div><button class="button primary" type="submit">Save</button></div>
</form>

<section class="card section stack" aria-labelledby="overrides-title" data-testid="ai-overrides">
  <h2 id="overrides-title">Spaces and dockets</h2>
  <p class="muted">
    Each space may choose other models within the list above, pay for its calls with its own key, and take a slice of this cap; each docket may
    choose its own models. Whoever may change settings on a space does that on its Settings tab.
  </p>
  {#if data.overrides.length}
    <ul class="overrides">
      {#each data.overrides as row (row.kind + row.slug)}
        <li>
          {#if row.kind === 'space'}
            <a href={resolve('/o/[org]/s/[space]/settings', { org: data.org.slug, space: row.slug })}>{row.name}</a> <span class="badge">space</span>
          {:else}
            <a href={resolve('/o/[org]/w/[ws]/settings', { org: data.org.slug, ws: row.slug })}>{row.name}</a> <span class="badge">docket</span>
          {/if}
          <span class="muted fine">
            {[row.models.length ? row.models.join(', ') : null, row.key, row.sliceUsd !== null ? `$${row.sliceUsd.toFixed(2)} a month` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted fine">Every space and docket runs on these settings.</p>
  {/if}
</section>

<style>
  .lede {
    margin-top: 0;
  }
  .section {
    max-width: 40rem;
    padding: 1.25rem;
    margin-top: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
  }
  .section p {
    margin: 0;
  }
  .fine {
    font-size: 0.8125rem;
  }
  .overrides {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .overrides li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
