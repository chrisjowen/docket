<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { historyOf, supersessions, type HistoryEntry } from '$lib/browse.js'
  import type { UiGraph } from '$lib/types.js'
  import TypeMark from '../type-mark.svelte'

  interface Props {
    graph: UiGraph
    selected: string | null
    onselect: (id: string) => void
  }

  let { graph, selected, onselect }: Props = $props()

  /** Days drawn at once. */
  const DAYS = 120

  let show = $state<'all' | 'event' | 'observed'>('all')

  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))
  const entries = $derived(historyOf(graph).filter((entry) => show === 'all' || entry.semantics === show))
  const days = $derived.by(() => {
    const grouped = new Map<string, HistoryEntry[]>()
    for (const entry of entries) grouped.set(entry.day, [...(grouped.get(entry.day) ?? []), entry])
    return [...grouped.entries()]
  })
  const chains = $derived(supersessions(graph.edges))

  const when = (day: string): string => {
    const date = new Date(`${day}T00:00:00`)
    return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }

  /** A time of day, when the value carries one. */
  const timeOf = (at: string): string | null => {
    const match = /T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(at)
    if (!match || at.endsWith('T00:00:00.000Z')) return null
    return `${match[1]}${match[2] ? ` ${match[2] === 'Z' ? 'UTC' : match[2]}` : ''}`
  }
</script>

<div class="h-full min-h-0 overflow-auto">
  <div class="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-5">
    {#if chains.length > 0}
      <section class="flex flex-col gap-3">
        <h2 class="section-title text-base">Supersessions</h2>
        <p class="text-muted-foreground -mt-2 text-xs">
          From each <code class="font-mono">supersedes</code> relationship: the record in force first, then what it replaced.
        </p>
        <ol class="flex flex-col gap-2">
          {#each chains as chain (chain.join('>'))}
            <li class="bg-card flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
              {#each chain as id, index (id)}
                {@const entity = byId.get(id)}
                {#if index > 0}
                  <span class="text-muted-foreground inline-flex items-center gap-1 text-xs"><ArrowRight class="size-3" /> supersedes</span>
                {/if}
                <button
                  type="button"
                  class="hover:bg-muted inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 {index > 0 ? 'text-muted-foreground line-through decoration-1' : 'font-medium'} {id === selected ? 'bg-accent' : ''}"
                  onclick={() => onselect(id)}
                >
                  <TypeMark type={entity?.type ?? null} size="sm" />
                  {entity?.title ?? id}
                </button>
                {#if index === 0}<Badge variant="secondary" class="text-[10px]">current</Badge>{/if}
              {/each}
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="section-title text-base">Observations over time</h2>
        <div role="tablist" aria-label="Which times" class="bg-muted inline-flex rounded-lg p-0.5">
          {#each [['all', 'Both'], ['event', 'When it happened'], ['observed', 'When it was observed']] as const as [id, label] (id)}
            <button
              type="button"
              role="tab"
              aria-selected={show === id}
              class="rounded-md px-2.5 py-1 text-xs {show === id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => (show = id)}
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
      <p class="text-muted-foreground -mt-1 text-xs">
        <span class="font-medium text-foreground">Happened</span> is the evidence's <code class="font-mono">eventAt</code>, recorded only
        when known. <span class="font-medium text-foreground">Observed</span> is its <code class="font-mono">observedAt</code>: when someone
        or something saw it. Neither is ever inferred from a file's modification time.
      </p>

      {#if days.length === 0}
        <p class="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          {#if show === 'event'}
            No evidence records when what it saw happened (<code class="font-mono">eventAt</code>).
          {:else if show === 'observed'}
            No evidence records when it was observed (<code class="font-mono">observedAt</code>).
          {:else}
            No evidence on file is dated. Evidence with <code class="font-mono">observedAt</code> or <code class="font-mono">eventAt</code>
            shows here.
          {/if}
        </p>
      {:else}
        <ol class="flex flex-col gap-5">
          {#each days.slice(0, DAYS) as [day, items] (day)}
            <li class="grid grid-cols-[7rem_1fr] gap-3">
              <time datetime={day} class="text-muted-foreground pt-1.5 text-right font-serif text-sm">{when(day)}</time>
              <ol class="flex flex-col gap-1.5 border-l pl-4">
                {#each items as entry (entry.key)}
                  {@const time = timeOf(entry.at)}
                  <li class="relative">
                    <span
                      class="absolute top-3 -left-[1.3rem] size-2 rounded-full {entry.semantics === 'event' ? 'bg-gilt' : 'border-muted-foreground border bg-background'}"
                      aria-hidden="true"
                    ></span>
                    <button
                      type="button"
                      class="hover:bg-muted flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm {entry.row.entity.id === selected ? 'bg-accent' : ''}"
                      onclick={() => onselect(entry.row.entity.id)}
                    >
                      <span class="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={entry.semantics === 'event' ? 'default' : 'outline'}
                          class="text-[10px]"
                          title={entry.semantics === 'event' ? 'eventAt: when it happened' : 'observedAt: when it was seen'}
                        >
                          {entry.semantics === 'event' ? 'happened' : 'observed'}{time ? ` ${time}` : ''}
                        </Badge>
                        <TypeMark type={entry.row.entity.type} size="sm" />
                        <span class="font-medium">{entry.row.entity.title}</span>
                        {#if entry.row.link}
                          <span class="text-muted-foreground inline-flex items-center gap-1 font-mono text-xs">
                            {entry.row.link.rel}<ArrowRight class="size-3" />{byId.get(entry.row.link.target)?.title ?? entry.row.link.target}
                          </span>
                        {/if}
                      </span>
                      {#if typeof entry.row.evidence.note === 'string'}<span class="break-words">{entry.row.evidence.note}</span>{/if}
                      <span class="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                        {#if entry.row.source}<span class="font-mono">{entry.row.source}</span>{/if}
                        {#if entry.row.location}<span class="font-mono break-all">{entry.row.location}</span>{/if}
                        {#if typeof entry.row.evidence.observedBy === 'string'}<span>by {entry.row.evidence.observedBy}</span>{/if}
                      </span>
                    </button>
                  </li>
                {/each}
              </ol>
            </li>
          {/each}
        </ol>
        {#if days.length > DAYS}
          <p class="text-muted-foreground text-xs">Showing the latest {DAYS} days of {days.length}.</p>
        {/if}
      {/if}
    </section>
  </div>
</div>
