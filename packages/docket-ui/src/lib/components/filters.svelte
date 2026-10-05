<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity'
  import { Checkbox } from '$lib/components/ui/checkbox/index.js'
  import { countBy } from '$lib/model.js'
  import type { UiGraph } from '$lib/types.js'

  interface Props {
    graph: UiGraph
    colourOf: (type: string) => string
    hiddenTypes: SvelteSet<string>
    hiddenRels: SvelteSet<string>
    showUnresolved: boolean
  }

  let { graph, colourOf, hiddenTypes, hiddenRels, showUnresolved = $bindable() }: Props = $props()

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
  colour: ((name: string) => string) | null
)}
  <section class="flex flex-col gap-1">
    <div class="flex items-center justify-between px-1">
      <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h3>
      {#if hidden.size > 0}
        <button type="button" class="text-muted-foreground hover:text-foreground text-xs" onclick={() => hidden.clear()}>
          Show all
        </button>
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
          {#if colour}
            <span class="size-2.5 shrink-0 rounded-full" style="background: {colour(name)}"></span>
          {/if}
          <label for={id} class="min-w-0 flex-1 cursor-pointer truncate text-sm {colour ? '' : 'font-mono text-xs'}">{name}</label>
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
  {@render group('Types', typeCounts, hiddenTypes, typeDescriptions, colourOf)}
  {@render group('Relationships', relCounts, hiddenRels, relDescriptions, null)}

  {#if unresolved > 0}
    <section class="flex flex-col gap-1">
      <h3 class="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">Links</h3>
      <div class="hover:bg-muted flex items-center gap-2 rounded-md px-1 py-1">
        <Checkbox id="show-unresolved" bind:checked={showUnresolved} />
        <span class="size-2.5 shrink-0 rounded-full border border-dashed" style="border-color: var(--graph-other)"></span>
        <label for="show-unresolved" class="flex-1 cursor-pointer text-sm">Unresolved targets</label>
        <span class="text-muted-foreground text-xs tabular-nums">{unresolved}</span>
      </div>
      <p class="text-muted-foreground px-1 text-xs">Linked to, but no file defines them yet.</p>
    </section>
  {/if}
</div>
