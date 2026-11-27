<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity'

  import { countBy, type UiGraph } from '$lib/graph/model'

  import TypeMark from './type-mark.svelte'

  /** Which exhibit types and relationships the board shows (docket-ui's `filters`). */
  interface Props {
    graph: UiGraph
    hiddenTypes: SvelteSet<string>
    hiddenRels: SvelteSet<string>
    showUnresolved: boolean
  }

  let { graph, hiddenTypes, hiddenRels, showUnresolved = $bindable() }: Props = $props()

  const describe = (list: { name: string; description?: string }[]) => new Map(list.map((item) => [item.name, item.description ?? '']))
  const sorted = (counts: Map<string, number>) => [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  const typeCounts = $derived(sorted(countBy(graph.entities, (entity) => entity.type)))
  const relCounts = $derived(sorted(countBy(graph.edges, (edge) => edge.rel)))
  const typeDescriptions = $derived(describe(graph.types))
  const relDescriptions = $derived(describe(graph.relationships))
  const unresolved = $derived(new Set(graph.edges.filter((edge) => edge.dangling).map((edge) => edge.target)).size)

  const toggle = (set: SvelteSet<string>, name: string, shown: boolean): void => {
    if (shown) set.delete(name)
    else set.add(name)
  }
  const setAll = (set: SvelteSet<string>, all: string[], shown: boolean): void => {
    set.clear()
    if (!shown) for (const name of all) set.add(name)
  }
  /** Show only this one; showing only the one already alone shows everything again. */
  const only = (set: SvelteSet<string>, all: string[], name: string): void => {
    const alone = !set.has(name) && all.every((other) => other === name || set.has(other))
    set.clear()
    if (!alone) for (const other of all) if (other !== name) set.add(other)
  }
</script>

{#snippet group(title: string, counts: [string, number][], hidden: SvelteSet<string>, descriptions: Map<string, string>, typed: boolean)}
  {@const names = counts.map(([name]) => name)}
  {@const shown = names.filter((name) => !hidden.has(name)).length}
  <section>
    <div class="title">
      <h3>{title}</h3>
      {#if names.length > 0}
        <div class="all" role="group" aria-label="{title}: switch all">
          <button type="button" aria-pressed={shown === names.length} onclick={() => setAll(hidden, names, true)}>All</button>
          <button type="button" aria-pressed={shown === 0} onclick={() => setAll(hidden, names, false)}>None</button>
        </div>
      {/if}
    </div>
    {#if counts.length === 0}<p class="muted small">None yet.</p>{/if}
    <ul>
      {#each counts as [name, count] (name)}
        {@const id = `${title}-${name}`}
        <li title={descriptions.get(name) || undefined}>
          <input {id} type="checkbox" checked={!hidden.has(name)} onchange={(event) => toggle(hidden, name, event.currentTarget.checked)} />
          {#if typed}<TypeMark type={name} size="sm" dim={hidden.has(name)} />{/if}
          <label for={id} class:mono={!typed}>{name}</label>
          <button type="button" class="only" onclick={() => only(hidden, names, name)}>only</button>
          <span class="muted small count">{count}</span>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<div class="filters" data-testid="filters">
  {@render group('Exhibit types', typeCounts, hiddenTypes, typeDescriptions, true)}
  {@render group('Relationships', relCounts, hiddenRels, relDescriptions, false)}
  {#if unresolved > 0}
    <section>
      <h3>References</h3>
      <ul>
        <li>
          <input id="show-unresolved" type="checkbox" bind:checked={showUnresolved} />
          <TypeMark type={null} size="sm" />
          <label for="show-unresolved">Unresolved targets</label>
          <span class="muted small count">{unresolved}</span>
        </li>
      </ul>
      <p class="muted small">Cited by an exhibit, but no document in the docket defines them yet.</p>
    </section>
  {/if}
</div>

<style>
  .filters {
    display: grid;
    gap: 1.25rem;
    padding: 0.75rem;
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h3 {
    margin: 0;
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .all button,
  .only {
    border: 0;
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    background: none;
    color: var(--muted-foreground);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .all button[aria-pressed='true'] {
    background: var(--muted);
    color: var(--foreground);
  }
  ul {
    list-style: none;
    margin: 0.35rem 0 0;
    padding: 0;
    display: grid;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.2rem 0.25rem;
    border-radius: var(--radius);
  }
  li:hover {
    background: var(--muted);
  }
  input[type='checkbox'] {
    margin: 0;
    padding: 0;
    accent-color: var(--gilt);
  }
  label {
    display: block;
    font-weight: 400;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    cursor: pointer;
  }
  label.mono {
    font-size: 0.75rem;
  }
  .only {
    visibility: hidden;
  }
  li:hover .only,
  .only:focus-visible {
    visibility: visible;
  }
  .small {
    font-size: 0.75rem;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  p {
    margin: 0.35rem 0.25rem 0;
  }
</style>
