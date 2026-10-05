<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Search from '@lucide/svelte/icons/search'
  import { Kbd } from '$lib/components/ui/kbd/index.js'
  import { quickSearch, type QuickResult } from '$lib/model.js'
  import type { UiEdge, UiGraph } from '$lib/types.js'

  interface Props {
    graph: UiGraph
    colourOf: (type: string) => string
    onentity: (id: string) => void
    onrelationship: (edge: UiEdge) => void
  }

  let { graph, colourOf, onentity, onrelationship }: Props = $props()

  let input: HTMLInputElement | undefined = $state()
  let text = $state('')
  let open = $state(false)
  let active = $state(0)

  const results = $derived(quickSearch(graph, text, 30))
  const titles = $derived(new Map(graph.entities.map((entity) => [entity.id, entity.title])))
  const typeOf = $derived(new Map(graph.entities.map((entity) => [entity.id, entity.type])))

  $effect(() => {
    void results
    active = 0
  })

  function choose(result: QuickResult | undefined): void {
    if (!result) return
    if (result.kind === 'entity') onentity(result.entity.id)
    else onrelationship(result.edge)
    open = false
    input?.blur()
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      active = Math.min(results.length - 1, active + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      active = Math.max(0, active - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === 'Escape') {
      open = false
      input?.blur()
    }
  }

  /** ⌘K, Ctrl-K or / from anywhere that is not already a text field. */
  function onwindowkeydown(event: KeyboardEvent): void {
    const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
    if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
      event.preventDefault()
      input?.focus()
      input?.select()
    }
  }

  $effect(() => {
    if (!open) return
    document.getElementById(`quick-${active}`)?.scrollIntoView({ block: 'nearest' })
  })

  const FIELD_LABEL: Record<string, string> = {
    id: 'id',
    title: 'title',
    type: 'type',
    tag: 'tag',
    attribute: 'attribute',
    body: 'notes'
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div class="relative w-full max-w-xl">
  <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
  <input
    bind:this={input}
    bind:value={text}
    type="text"
    name="quick-search"
    role="combobox"
    aria-expanded={open && results.length > 0}
    aria-controls="quick-results"
    aria-activedescendant={open && results.length > 0 ? `quick-${active}` : undefined}
    aria-label="Quick search entities and relationships"
    placeholder="Search entities and relationships…  type: rel: tag:"
    autocomplete="off"
    spellcheck="false"
    class="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border pr-14 pl-8 text-sm outline-none focus-visible:ring-3"
    onfocus={() => (open = true)}
    oninput={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 120)}
    {onkeydown}
  />
  <Kbd class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">⌘K</Kbd>

  {#if open && text.trim() !== ''}
    <div
      id="quick-results"
      role="listbox"
      class="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border p-1 shadow-lg"
    >
      {#if results.length === 0}
        <div class="text-muted-foreground px-3 py-6 text-center text-sm">No entity or relationship matches.</div>
      {/if}
      {#each results as result, index (index)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id="quick-{index}"
          role="option"
          tabindex="-1"
          aria-selected={index === active}
          class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm {index === active ? 'bg-accent text-accent-foreground' : ''}"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => choose(result)}
          onmouseenter={() => (active = index)}
        >
          {#if result.kind === 'entity'}
            <span class="size-2.5 shrink-0 rounded-full" style="background: {colourOf(result.entity.type)}"></span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{result.entity.title}</span>
              {#if result.snippet}
                <span class="text-muted-foreground truncate text-xs">{result.snippet}</span>
              {:else}
                <span class="text-muted-foreground truncate font-mono text-xs">{result.entity.id}</span>
              {/if}
            </span>
            <span class="text-muted-foreground shrink-0 text-xs">{result.entity.type}</span>
          {:else}
            {@const edge = result.edge}
            <span class="flex min-w-0 flex-1 items-center gap-1.5">
              <span class="size-2 shrink-0 rounded-full" style="background: {colourOf(typeOf.get(edge.source) ?? '')}"></span>
              <span class="truncate">{titles.get(edge.source) ?? edge.source}</span>
              <span class="text-muted-foreground inline-flex shrink-0 items-center gap-0.5 font-mono text-xs">
                {edge.rel}<ArrowRight class="size-3" />
              </span>
              <span class="truncate {edge.dangling ? 'text-muted-foreground italic' : ''}">{titles.get(edge.target) ?? edge.target}</span>
            </span>
            <span class="text-muted-foreground shrink-0 text-xs">relationship</span>
          {/if}
        </div>
      {/each}
      {#if results.length > 0}
        <div class="text-muted-foreground border-t px-2 pt-1.5 pb-1 text-[11px]">
          ↑↓ to move · Enter to show on the graph · {results[active]?.kind === 'entity'
            ? `matched ${FIELD_LABEL[(results[active] as Extract<QuickResult, { kind: 'entity' }>).field]}`
            : 'relationship'}
        </div>
      {/if}
    </div>
  {/if}
</div>
