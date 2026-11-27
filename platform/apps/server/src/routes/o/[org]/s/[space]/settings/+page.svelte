<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Cpu, Database, KeyRound, Server, Wallet } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import ModelSlots from '$lib/components/model-slots.svelte'

  let { data, form } = $props()

  const graphStatus: Record<string, { label: string; tone: string }> = {
    requested: { label: 'Asked for', tone: 'idle' },
    provisioning: { label: 'Starting', tone: 'warn' },
    ready: { label: 'Running', tone: '' },
    suspended: { label: 'Asleep (wakes on use)', tone: 'idle' },
    failed: { label: 'Failed', tone: 'red' },
    retiring: { label: 'Going back to the account’s', tone: 'warn' },
  }
  const money = (value: number) => `$${value.toFixed(2)}`
  const ownGraph = $derived(data.storage.graph && data.storage.graph.status !== 'retiring' ? data.storage.graph : null)
</script>

<svelte:head>
  <title>Settings · {data.space.name}</title>
</svelte:head>

<p class="muted lede">
  What {data.space.name}'s dockets run on. Anything you leave as it is comes from {data.org.name}; anything you choose stays within what
  {data.org.name} allows. Changes are recorded in the audit log.
</p>

{#if form && 'problem' in form}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form && 'flash' in form}<p class="flash" role="status">{form.flash}</p>{/if}

<form method="POST" action="?/models" class="card block" aria-labelledby="models-title" data-testid="space-models">
  <Csrf token={data.csrf} />
  <h2 id="models-title"><Cpu size={17} aria-hidden="true" /> Models</h2>
  <p class="muted small">
    {#if data.key}Calls go on {data.space.name}'s own {data.key.providerLabel} key, so only models {data.key.providerLabel} serves are offered.{:else}Calls
      go on {data.org.name}'s key, within its monthly cap.{/if}
  </p>
  <ModelSlots slots={data.models} above={data.org.name} limitLabel="Dockets in {data.space.name} may choose from" />

  <fieldset class="slice">
    <legend><Wallet size={15} aria-hidden="true" /> Monthly AI budget</legend>
    <p class="muted small">
      {data.org.name}'s cap is <strong>{money(data.budget.accountCapUsd)}</strong> a month ({money(data.budget.accountSpentUsd)} spent in {data.budget.month}).
      {data.space.name}'s dockets spent <strong>{money(data.budget.spentUsd)}</strong> this month. Give {data.space.name} a slice to stop its dockets
      before they spend more than that; it can never be more than the account's cap.
    </p>
    <p class="muted small">
      The slice holds spend on {data.org.name}'s key and on an OpenRouter key of {data.space.name}'s own. Anthropic and OpenAI keys report no cost,
      so calls on them are recorded but not held to the slice.
    </p>
    <label>
      Slice for {data.space.name} (US dollars, empty for none)
      <input name="slice" type="number" min="0" max={data.budget.accountCapUsd} step="1" value={data.budget.sliceUsd ?? ''} inputmode="decimal" />
    </label>
    {#if data.budget.sliceUsd !== null && data.budget.effectiveUsd !== null && data.budget.effectiveUsd < data.budget.sliceUsd}
      <p class="small warn-text">The account's cap is lower now, so {money(data.budget.effectiveUsd)} holds.</p>
    {/if}
  </fieldset>
  <div><button class="button primary" type="submit">Save models and budget</button></div>
</form>

<section class="card block" aria-labelledby="key-title" data-testid="space-key">
  <h2 id="key-title"><KeyRound size={17} aria-hidden="true" /> Who pays for model calls</h2>
  {#if data.key}
    <p>
      <span class="status"><i></i>{data.key.providerLabel} key …{data.key.hint}</span>
      <span class="muted small">added {new Date(data.key.createdAt).toLocaleDateString()}{data.key.createdBy ? ` by @${data.key.createdBy}` : ''}</span>
    </p>
    <p class="muted small">
      {data.space.name}'s dockets call {data.key.providerLabel} with this key; {data.org.name}'s key is not used for them. Docket never shows the key
      again. Calls are still metered here and do not count toward {data.org.name}'s cap.
      {#if data.key.provider === 'openrouter'}The slice above still holds.{:else}{data.key.providerLabel} reports no cost, so the slice above does
        not hold calls on this key.{/if}
    </p>
    <form method="POST" action="?/removeKey" class="inline">
      <Csrf token={data.csrf} />
      <button class="button" type="submit">Go back to {data.org.name}'s key</button>
    </form>
  {:else}
    <p class="muted small">
      {data.org.name}'s key, capped at its monthly budget. Bring {data.space.name}'s own OpenRouter, Anthropic or OpenAI key to pay for its dockets'
      calls yourselves.
    </p>
  {/if}
  <form method="POST" action="?/setKey" class="key-form" autocomplete="off">
    <Csrf token={data.csrf} />
    <label>
      Provider
      <select name="provider">
        {#each data.providers as provider (provider.id)}<option value={provider.id} selected={data.key?.provider === provider.id}>{provider.label}</option>{/each}
      </select>
    </label>
    <label class="grow">
      {data.key ? 'New key' : 'Key'}
      <input name="key" type="password" required minlength="8" maxlength="512" autocomplete="off" spellcheck="false" placeholder="Paste the key" />
    </label>
    <button class="button primary" type="submit">{data.key ? 'Replace key' : 'Use this key'}</button>
  </form>
  <p class="muted small">Sealed with {data.org.name}'s own encryption key the moment it arrives; only its last four characters are shown again.</p>
</section>

<section class="card block" aria-labelledby="storage-title" data-testid="space-storage">
  <h2 id="storage-title"><Database size={17} aria-hidden="true" /> Storage</h2>
  <div class="table-wrap">
    <table class="grid stackable" aria-label="Where {data.space.name}'s dockets keep what they know">
      <thead><tr><th>Component</th><th>Engine</th><th>{data.space.name} uses</th></tr></thead>
      <tbody>
        <tr>
          <td data-label="Component">Records, the source of truth</td>
          <td data-label="Engine">PostgreSQL</td>
          <td data-label="Uses">{data.org.name}'s own schema and encryption key, always</td>
        </tr>
        <tr data-testid="storage-graph">
          <td data-label="Component">Graph</td>
          <td data-label="Engine">Neo4j</td>
          <td data-label="Uses">
            {#if ownGraph}
              Its own instance
              <span class="status {graphStatus[ownGraph.status]?.tone ?? ''}"><i></i>{graphStatus[ownGraph.status]?.label ?? ownGraph.status}</span>
              {#if ownGraph.status === 'failed' && ownGraph.lastError}<span class="small block-line warn-text">{ownGraph.lastError}</span>{/if}
            {:else if data.storage.graph?.status === 'retiring'}
              {data.org.name}'s instance <span class="status warn"><i></i>Moving back</span>
            {:else}
              {data.org.name}'s instance, shared with its other spaces
            {/if}
          </td>
        </tr>
        <tr>
          <td data-label="Component">Search</td>
          <td data-label="Engine">Qdrant</td>
          <td data-label="Uses">
            A collection of its own for each docket{#if data.storage.sharedCollection}, except {data.storage.sharedCollection} older docket{data.storage.sharedCollection === 1
                ? ''
                : 's'}, which keep{data.storage.sharedCollection === 1 ? 's' : ''} {data.org.name}'s shared collection{/if}
          </td>
        </tr>
        <tr>
          <td data-label="Component">Embeddings</td>
          <td data-label="Engine">nomic-embed-text</td>
          <td data-label="Uses">Docket's, in the cluster: text never leaves it to be embedded</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="graph-choice">
    {#if ownGraph}
      <p class="muted small">
        {data.space.name}'s dockets project into an instance only they use. Going back moves them to {data.org.name}'s instance, rebuilds them there
        from their records, and removes this one.
      </p>
      <form method="POST" action="?/sharedGraph" class="inline">
        <Csrf token={data.csrf} />
        <button class="button" type="submit">Go back to {data.org.name}'s Neo4j</button>
      </form>
    {:else}
      <p class="small pods" data-testid="pods-left">
        <Server size={14} aria-hidden="true" />
        <span><strong>{data.storage.pods.left}</strong> of {data.storage.pods.capacity} Neo4j pods left on this box</span>
      </p>
      <p class="muted small">
        Give {data.space.name} its own Neo4j instance (+1 pod) to keep its graph apart from {data.org.name}'s other spaces. Its dockets move there once
        it is up and are rebuilt from their records; nothing is copied, and search keeps working meanwhile.
      </p>
      <form method="POST" action="?/ownGraph" class="inline">
        <Csrf token={data.csrf} />
        <button class="button primary" type="submit" disabled={data.storage.pods.left < 1 || data.storage.graph?.status === 'retiring'}>
          Give {data.space.name} its own Neo4j (+1 pod)
        </button>
      </form>
      {#if data.storage.pods.left < 1}<p class="small warn-text">No room for another pod on this box.</p>{/if}
    {/if}
  </div>
</section>

<style>
  .lede {
    max-width: 48rem;
    margin-top: 0;
  }
  .block {
    display: grid;
    gap: 0.75rem;
    padding: 1rem 1.1rem;
    margin-top: 1rem;
    min-width: 0;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 1.1rem;
    margin: 0;
  }
  p {
    margin: 0;
  }
  .small {
    font-size: 0.8125rem;
  }
  .slice {
    display: grid;
    gap: 0.5rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    padding: 0.75rem 0.9rem;
    margin: 0;
    min-width: 0;
  }
  .slice legend {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.3rem;
    font-weight: 500;
  }
  .slice label,
  .key-form label {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  .slice input {
    max-width: 12rem;
  }
  .key-form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
  }
  .grow {
    flex: 1;
    /* On a phone the key takes a line of its own. */
    min-width: min(100%, 16rem);
  }
  .inline {
    display: inline;
  }
  .warn-text {
    color: var(--warn);
  }
  .block-line {
    display: block;
    margin-top: 0.25rem;
    overflow-wrap: anywhere;
  }
  .graph-choice {
    display: grid;
    gap: 0.5rem;
  }
  .pods {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  td .status {
    margin-left: 0.35rem;
  }
</style>
