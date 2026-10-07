<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity'
  import { Checkbox } from '$lib/components/ui/checkbox/index.js'
  import { countBy } from '$lib/model.js'
  import type { UiGraph } from '$lib/types.js'
  import TypeMark from './type-mark.svelte'

  interface Props {
    graph: UiGraph
    hiddenTypes: SvelteSet<string>
    hiddenRels: SvelteSet<string>
    showUnresolved: boolean
  }

  let { graph, hiddenTypes, hiddenRels, showUnresolved = $bindable() }: Props = $props()

  const describe = (list: { name: string; description?: string }[]) =>
    new Map(list.map((item) => [item.name, item.description ?? '']))

  const typeCounts = $derived(
    [...countBy(graph.entities, (entity) => entity.type)].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  )
  const relCounts = $derived(
    [...countBy(graph.edges, (edge) => edge.rel)].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  )
  const typeDescriptions = $derived(describe(graph.types))
  const relDescriptions = $derived(describe(graph.relationships))
  const unresolved = $derived(new Set(graph.edges.filter((edge) => edge.dangling).map((edge) => edge.target)).size)

  const toggle = (set: SvelteSet<string>, name: string, visible: boolean): void => {
    if (visible) set.delete(name)
    else set.add(name)
  }

  /** Every one on, or every one off. */
  const setAll = (set: SvelteSet<string>, all: string[], visible: boolean): void => {
    set.clear()
    if (!visible) for (const name of all) set.add(name)
  }

  /** Show only this one; showing only the one already alone shows everything again. */
  const only = (set: SvelteSet<string>, all: string[], name: string): void => {
    const alone = !set.has(name) && all.every((other) => other === name || set.has(other))
    set.clear()
    if (!alone) for (const other of all) if (other !== name) set.add(other)
  }
</script>

{#snippet group(
  title: string,
  counts: [string, number][],
  hidden: SvelteSet<string>,
  descriptions: Map<string, string>,
  typed: boolean
)}
  {@const names = counts.map(([name]) => name)}
  {@const shown = names.filter((name) => !hidden.has(name)).length}
  <section class="flex flex-col gap-1">
    <div class="flex items-center justify-between gap-2 px-1">
      <h3 class="section-title">{title}</h3>
      {#if names.length > 0}
        <div class="flex items-center gap-0.5 text-xs" role="group" aria-label="{title}: switch all">
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-muted rounded px-1.5 py-0.5"
            aria-pressed={shown === names.length}
            onclick={() => setAll(hidden, names, true)}
          >
            All
          </button>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-muted rounded px-1.5 py-0.5"
            aria-pressed={shown === 0}
            onclick={() => setAll(hidden, names, false)}
          >
            None
          </button>
        </div>
      {/if}
    </div>
    {#if counts.length === 0}
      <p class="text-muted-foreground px-1 text-xs">None yet.</p>
    {/if}
    <ul class="flex flex-col">
      {#each counts as [name, count] (name)}
        {@const id = `${title}-${name}`}
        <li class="group hover:bg-muted flex items-center gap-2 rounded-md px-1 py-1" title={descriptions.get(name) || undefined}>
          <Checkbox {id} checked={!hidden.has(name)} onCheckedChange={(visible) => toggle(hidden, name, visible === true)} />
          {#if typed}<TypeMark type={name} size="sm" class={hidden.has(name) ? 'opacity-40' : ''} />{/if}
          <label for={id} class="min-w-0 flex-1 cursor-pointer truncate text-sm {typed ? '' : 'font-mono text-xs'}">{name}</label>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground hidden text-[11px] group-hover:inline"
            onclick={() => only(hidden, counts.map(([other]) => other), name)}
          >
            only
          </button>
          <span class="text-muted-foreground text-xs tabular-nums">{count}</span>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<div class="flex flex-col gap-5 p-3">
  {@render group('Exhibit types', typeCounts, hiddenTypes, typeDescriptions, true)}
  {@render group('Relationships', relCounts, hiddenRels, relDescriptions, false)}

  {#if unresolved > 0}
    <section class="flex flex-col gap-1">
      <h3 class="section-title px-1">References</h3>
      <div class="hover:bg-muted flex items-center gap-2 rounded-md px-1 py-1">
        <Checkbox id="show-unresolved" bind:checked={showUnresolved} />
        <TypeMark type={null} size="sm" />
        <label for="show-unresolved" class="flex-1 cursor-pointer text-sm">Unresolved targets</label>
        <span class="text-muted-foreground text-xs tabular-nums">{unresolved}</span>
      </div>
      <p class="text-muted-foreground px-1 text-xs">Cited by an exhibit, but no file in the casebook defines them yet.</p>
    </section>
  {/if}
</div>
