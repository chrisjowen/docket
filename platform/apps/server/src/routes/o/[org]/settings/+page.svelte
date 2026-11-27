<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Csrf from '$lib/components/csrf.svelte'
  import OrgSettingsTabs from '$lib/components/org-settings-tabs.svelte'

  let { data, form } = $props()
</script>

<svelte:head>
  <title>Settings · {data.org.name}</title>
</svelte:head>

<h1>Settings</h1>
<OrgSettingsTabs org={data.org.slug} active="ai" />
<p class="muted lede">Owners only. Changes are recorded in the audit log.</p>

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
  <label>
    Monthly cap (US dollars, at most ${data.maxCapUsd})
    <input name="cap" type="number" min="0" max={data.maxCapUsd} step="1" value={data.ai.capUsd} required />
  </label>
  <label>
    Model for Cypher and extraction
    <select name="cypher">
      {#each data.allowlist.cypher as model (model)}<option value={model} selected={model === data.models.cypher}>{model}</option>{/each}
    </select>
  </label>
  <label>
    Model for answers
    <select name="synthesis">
      {#each data.allowlist.synthesis as model (model)}<option value={model} selected={model === data.models.synthesis}>{model}</option>{/each}
    </select>
  </label>
  <p class="muted fine">Every request asks OpenRouter for providers that neither train on prompts nor retain them.</p>
  <div><button class="button primary" type="submit">Save</button></div>
</form>

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
</style>
