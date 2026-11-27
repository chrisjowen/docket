<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Disposition, Migration } from '@docket/platform-ontology-service'
  import { CircleAlert, CircleCheck, LoaderCircle, Plus, ShieldAlert, Trash2, TriangleAlert } from '@lucide/svelte'

  import type { CheckState } from '$lib/ontology/types'

  let {
    result,
    migration,
    onmigration,
    dispositions,
    ondisposition,
    removedTypes,
    removedRelationships,
    types,
    relationships,
  }: {
    result: CheckState
    migration: Migration[]
    onmigration: (steps: Migration[]) => void
    /** By resource id: what the publisher decided for each resource a breaking change leaves unknown. */
    dispositions: Record<string, Disposition>
    ondisposition: (resourceId: string, disposition: Disposition) => void
    /** Types and relationships the head has and the draft does not: what a migration maps from. */
    removedTypes: string[]
    removedRelationships: string[]
    types: string[]
    relationships: string[]
  } = $props()

  const check = $derived(result.status === 'ok' ? result.check : null)
  const groups = $derived.by(() => {
    if (!check) return []
    const byResource: Record<string, { resourceId: string; origin: string; messages: { code: string; message: string; severity: string }[] }> = {}
    for (const d of check.introduced) {
      const id = d.id ?? d.path ?? ''
      const origin = check.affected.find((a) => a.resourceId === id)?.origin ?? 'cloud'
      const group = (byResource[id] ??= { resourceId: id, origin, messages: [] })
      group.messages.push({ code: d.code, message: d.message, severity: d.severity })
    }
    return Object.values(byResource)
  })
  const suggestions = $derived([
    ...removedTypes
      .filter((from) => !migration.some((step) => step.from === from && step.op !== 'renameRelationship'))
      .map((from) => ({ op: 'renameType' as const, from, to: '' })),
    ...removedRelationships
      .filter((from) => !migration.some((step) => step.from === from && step.op === 'renameRelationship'))
      .map((from) => ({ op: 'renameRelationship' as const, from, to: '' })),
  ])
  const bandChanges = $derived(check ? check.rescored.filter((each) => each.bandBefore !== each.bandAfter) : [])
  const showMigration = $derived(migration.length > 0 || check?.classification === 'breaking')

  function update(index: number, patch: Partial<Migration>) {
    onmigration(migration.map((step, i) => (i === index ? { ...step, ...patch } : step)))
  }
</script>

<section class="panel card" aria-label="Change check" data-classification={check?.classification ?? result.status}>
  <header>
    <h2>Change check</h2>
    {#if result.status === 'checking'}
      <span class="badge"><LoaderCircle size={12} aria-hidden="true" class="spin" /> checking</span>
    {:else if check}
      <span class="badge {check.classification}" data-testid="classification">{check.classification}</span>
    {:else if result.status === 'invalid' || result.status === 'migration'}
      <span class="badge invalid" data-testid="classification">invalid</span>
    {/if}
  </header>

  {#if result.status === 'invalid'}
    <p class="alert" role="alert">The draft is not a valid ontology:</p>
    <ul class="list mono">
      {#each result.diagnostics as d, i (i)}<li>{d.message}</li>{/each}
    </ul>
  {:else if result.status === 'error'}
    <p class="alert" role="alert">{result.message}</p>
  {:else if check}
    <p class="muted small">
      Re-validated {check.documents} document{check.documents === 1 ? '' : 's'} against v{check.head}{check.migrated.length
        ? `, with the migration rewriting ${check.migrated.length}`
        : ''}.
    </p>

    {#if check.classification === 'safe'}
      <p class="ok"><CircleCheck size={16} aria-hidden="true" /> No resource gains a diagnostic.</p>
    {:else if check.classification === 'rescore'}
      <p class="ok" data-testid="rescore">
        <CircleCheck size={16} aria-hidden="true" />
        Confidence only: {check.rescored.length} resource{check.rescored.length === 1 ? '' : 's'} and link{check.rescored.length === 1 ? '' : 's'} re-scored,
        {bandChanges.length} changing band{check.proposals.length ? `; ${check.proposals.length} supersede proposal${check.proposals.length === 1 ? '' : 's'} decided differently` : ''}.
      </p>
      {#if bandChanges.length}
        <ul class="list mono small" aria-label="Band changes">
          {#each bandChanges.slice(0, 12) as each (`${each.resourceId} ${each.link?.rel ?? ''} ${each.link?.target ?? ''}`)}
            <li>{each.resourceId}{each.link ? ` ${each.link.rel} -> ${each.link.target}` : ''}: {each.before} {each.bandBefore} → {each.after} {each.bandAfter}</li>
          {/each}
        </ul>
      {/if}
      {#if check.proposals.length}
        <ul class="list mono small" aria-label="Proposals decided differently">
          {#each check.proposals as each (each.proposal)}
            <li>{each.resource}: {each.change === 'would-accept' ? 'would be accepted' : 'would no longer pass (stays accepted)'} at {each.after} of {each.threshold}</li>
          {/each}
        </ul>
      {/if}
    {:else if check.classification === 'narrowing'}
      <p class="warning" role="status">
        <TriangleAlert size={16} aria-hidden="true" />
        {check.affected.length} resource{check.affected.length === 1 ? '' : 's'} would gain diagnostics. An admin can publish anyway.
      </p>
    {:else}
      <p class="blocking" role="alert" data-testid="blocking">
        <ShieldAlert size={16} aria-hidden="true" />
        Blocked: {check.affected.length} resource{check.affected.length === 1 ? '' : 's'} would become unknown to the ontology.
        Keep what they use, add a migration that moves them, or give each a disposition below.
      </p>
    {/if}

    {#if check.changes.length}
      <h3>Changes</h3>
      <ul class="list changes mono">
        {#each check.changes as change, i (i)}
          <li class="op-{change.op === '+' ? 'add' : change.op === '-' ? 'remove' : 'change'}">
            <span aria-hidden="true">{change.op === '-' ? '−' : change.op}</span>
            {change.text.replace(/`/g, '')}
          </li>
        {/each}
      </ul>
    {/if}

    {#if groups.length}
      <h3>New diagnostics</h3>
      <ul class="list resources">
        {#each groups as group (group.resourceId)}
          <li data-resource={group.resourceId}>
            <div>
              <strong class="mono">{group.resourceId}</strong>
              <span class="badge">{group.origin}</span>
              {#if group.origin !== 'cloud'}<span class="muted small">fix in {group.origin === 'repo' ? 'the repo' : 'the checkout'}</span>{/if}
            </div>
            {#each check.unresolved.filter((u) => u.resourceId === group.resourceId) as unresolved (unresolved.resourceId)}
              <select
                aria-label="Disposition of {group.resourceId}"
                value={dispositions[group.resourceId] ?? ''}
                onchange={(e) => ondisposition(group.resourceId, e.currentTarget.value as Disposition)}
              >
                <option value="" disabled>{unresolved.updatable ? 'choose: update in repo, or accept data loss' : 'choose: accept data loss, or add a migration step'}</option>
                {#if unresolved.updatable}<option value="update-in-repo">update in {group.origin === 'repo' ? 'the repo' : 'the checkout'}</option>{/if}
                <option value="accept-data-loss">accept data loss</option>
              </select>
            {/each}
            <ul>
              {#each group.messages as d, i (i)}
                <li class={d.severity}>
                  {#if d.severity === 'error'}<CircleAlert size={12} aria-hidden="true" />{:else}<TriangleAlert size={12} aria-hidden="true" />{/if}
                  <span class="mono">{d.code}</span>
                  {d.message}
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}

    {#if check.resolved.length}
      <p class="small ok">Clears {check.resolved.length} diagnostic{check.resolved.length === 1 ? '' : 's'} the head has.</p>
    {/if}
    {#if check.ontology.length}
      <h3>About the draft itself</h3>
      <ul class="list small">
        {#each check.ontology as d, i (i)}<li class="warning-text">{d.message}</li>{/each}
      </ul>
    {/if}
  {/if}

  {#if result.status === 'migration'}
    <p class="alert" role="alert">{result.problems.join(' ')}</p>
  {/if}

  {#if showMigration}
    <h3>Migration</h3>
    <p class="muted small">
      Rewrites cloud documents as new revisions when this publishes, each with evidence naming you. Repo and CLI documents
      are not rewritten.
    </p>
    {#each migration as step, i (i)}
      <div class="step" data-step={i}>
        <select aria-label="Migration step {i + 1}" value={step.op} onchange={(e) => update(i, { op: e.currentTarget.value as Migration['op'] })}>
          <option value="renameType">rename type</option>
          <option value="mapType">map type</option>
          <option value="renameRelationship">rename relationship</option>
          <option value="dropAttribute">drop attribute</option>
        </select>
        {#if step.op === 'dropAttribute'}
          <input aria-label="Type of step {i + 1}" class="mono" placeholder="type" value={step.type ?? ''} onchange={(e) => update(i, { type: e.currentTarget.value.trim() })} />
          <input aria-label="Attribute of step {i + 1}" class="mono" placeholder="attribute" value={step.from} onchange={(e) => update(i, { from: e.currentTarget.value.trim() })} />
        {:else}
          <input aria-label="From, step {i + 1}" class="mono" placeholder="from" value={step.from} onchange={(e) => update(i, { from: e.currentTarget.value.trim() })} />
          <span aria-hidden="true">→</span>
          <select aria-label="To, step {i + 1}" value={step.to ?? ''} onchange={(e) => update(i, { to: e.currentTarget.value })}>
            <option value="" disabled>choose</option>
            {#each step.op === 'renameRelationship' ? relationships : types as name (name)}<option value={name}>{name}</option>{/each}
          </select>
        {/if}
        <button type="button" class="button small danger" aria-label="Remove step {i + 1}" onclick={() => onmigration(migration.filter((_, j) => j !== i))}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
    {/each}
    <div class="suggest">
      {#each suggestions as suggestion (suggestion.op + suggestion.from)}
        <button type="button" class="button small" onclick={() => onmigration([...migration, suggestion])}>
          <Plus size={13} aria-hidden="true" /> Migrate {suggestion.op === 'renameType' ? 'type' : 'relationship'}
          <span class="mono">{suggestion.from}</span>
        </button>
      {/each}
      <button type="button" class="button small" onclick={() => onmigration([...migration, { op: 'renameType', from: '', to: '' }])}>
        <Plus size={13} aria-hidden="true" /> Add a step
      </button>
    </div>
  {/if}
</section>

<style>
  .panel {
    padding: 0.9rem 1rem;
    display: grid;
    gap: 0.5rem;
    align-content: start;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0;
  }
  h3 {
    font-family: var(--font-sans);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-foreground);
    margin: 0.5rem 0 0;
  }
  .small {
    font-size: 0.8125rem;
  }
  p {
    margin: 0;
  }
  .ok,
  .warning,
  .blocking {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
    font-size: 0.875rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius);
  }
  .ok {
    color: var(--ok);
  }
  .warning {
    color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .blocking {
    color: var(--foreground);
    border: 1px solid color-mix(in srgb, var(--destructive) 55%, transparent);
    background: color-mix(in srgb, var(--destructive) 14%, transparent);
  }
  .blocking :global(svg) {
    color: var(--destructive);
    flex: none;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
    font-size: 0.8125rem;
    min-width: 0;
  }
  .list li {
    overflow-wrap: anywhere;
  }
  .changes .op-add span {
    color: var(--ok);
  }
  .changes .op-remove span {
    color: var(--destructive);
  }
  .changes .op-change span {
    color: var(--warn);
  }
  .resources > li {
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .resources > li > div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .resources ul {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.2rem;
  }
  .resources .error :global(svg) {
    color: var(--destructive);
  }
  .resources .warning :global(svg),
  .warning-text {
    color: var(--warn);
  }
  .step {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }
  .step input,
  .step select {
    padding: 0.25rem 0.4rem;
    font-size: 0.8125rem;
    max-width: 9rem;
  }
  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.spin) {
      animation: none;
    }
  }
</style>
