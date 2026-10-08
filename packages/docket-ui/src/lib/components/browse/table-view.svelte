<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import ArrowUp from '@lucide/svelte/icons/arrow-up'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import {
    bandOf,
    dayOf,
    exhibitRows,
    filterExhibits,
    filterObservations,
    observationRows,
    type AssessmentFilter,
    type ExhibitRow,
    type ObservationRow,
    type TableFilter
  } from '$lib/browse.js'
  import { basisLabel } from '$lib/model.js'
  import type { UiGraph } from '$lib/types.js'
  import TypeMark from '../type-mark.svelte'

  interface Props {
    graph: UiGraph
    selected: string | null
    onselect: (id: string) => void
  }

  let { graph, selected, onselect }: Props = $props()

  /** Rows drawn at once; the filters narrow the rest. */
  const SHOWN = 500

  let rows = $state<'exhibits' | 'observations'>('exhibits')
  let text = $state('')
  let type = $state('')
  let source = $state('')
  let from = $state('')
  let to = $state('')
  let assessment = $state<AssessmentFilter>('any')

  type ExhibitKey = 'title' | 'type' | 'confidence' | 'evidence' | 'observed' | 'path'
  type ObservationKey = 'title' | 'source' | 'location' | 'observed' | 'event'
  let exhibitSort = $state<{ key: ExhibitKey; down: boolean }>({ key: 'title', down: false })
  let observationSort = $state<{ key: ObservationKey; down: boolean }>({ key: 'observed', down: true })

  const filter = $derived<TableFilter>({
    types: new Set(type ? [type] : []),
    sources: new Set(source ? [source] : []),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    assessment,
    text
  })

  const allExhibits = $derived(exhibitRows(graph))
  const allObservations = $derived(observationRows(graph))
  const types = $derived([...new Set(graph.entities.map((entity) => entity.type))].sort())
  const sources = $derived(
    [...new Set([...allExhibits.flatMap((row) => row.sources), ...allObservations.flatMap((row) => (row.source ? [row.source] : []))])].sort()
  )

  const compare = (a: string | number | undefined, b: string | number | undefined): number => {
    // Missing values sort last either way.
    if (a === undefined) return b === undefined ? 0 : 1
    if (b === undefined) return -1
    return a < b ? -1 : a > b ? 1 : 0
  }

  const exhibitValue = (row: ExhibitRow, key: ExhibitKey): string | number | undefined =>
    ({
      title: row.entity.title.toLowerCase(),
      type: row.entity.type,
      confidence: row.confidence,
      evidence: row.evidenceCount,
      observed: row.lastObserved,
      path: row.entity.path
    })[key]

  const observationValue = (row: ObservationRow, key: ObservationKey): string | number | undefined =>
    ({
      title: row.entity.title.toLowerCase(),
      source: row.source,
      location: row.location || undefined,
      observed: row.observedAt,
      event: row.eventAt
    })[key]

  const sorted = <T, K>(items: T[], sort: { key: K; down: boolean }, value: (item: T, key: K) => string | number | undefined): T[] =>
    [...items].sort((a, b) => {
      const [x, y] = [value(a, sort.key), value(b, sort.key)]
      if (x === undefined || y === undefined) return compare(x, y)
      return sort.down ? compare(y, x) : compare(x, y)
    })

  const exhibits = $derived(sorted(filterExhibits(allExhibits, filter), exhibitSort, exhibitValue))
  const observations = $derived(sorted(filterObservations(allObservations, filter), observationSort, observationValue))
  const count = $derived(rows === 'exhibits' ? exhibits.length : observations.length)
  const total = $derived(rows === 'exhibits' ? allExhibits.length : allObservations.length)
  const filtered = $derived(Boolean(text || type || source || from || to || assessment !== 'any'))

  function clear(): void {
    text = ''
    type = ''
    source = ''
    from = ''
    to = ''
    assessment = 'any'
  }

  const titleOf = (id: string): string => graph.entities.find((entity) => entity.id === id)?.title ?? id
</script>

{#snippet sortHeader(label: string, active: boolean, down: boolean, onclick: () => void)}
  <th scope="col" class="px-3 py-2 font-medium" aria-sort={active ? (down ? 'descending' : 'ascending') : 'none'}>
    <button type="button" class="hover:text-foreground inline-flex items-center gap-1" {onclick}>
      {label}
      {#if active}{#if down}<ArrowDown class="size-3" />{:else}<ArrowUp class="size-3" />{/if}{/if}
    </button>
  </th>
{/snippet}

<div class="flex h-full min-h-0 min-w-0 flex-col">
  <div class="flex flex-wrap items-end gap-x-3 gap-y-2 border-b px-4 py-3">
    <div role="tablist" aria-label="Rows" class="bg-muted inline-flex rounded-lg p-0.5">
      {#each [['exhibits', 'Exhibits'], ['observations', 'Observations']] as const as [id, label] (id)}
        <button
          type="button"
          role="tab"
          aria-selected={rows === id}
          class="rounded-md px-2.5 py-1 text-xs {rows === id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (rows = id)}
        >
          {label}
        </button>
      {/each}
    </div>
    <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs">
      <span class="text-muted-foreground">Contains</span>
      <Input bind:value={text} placeholder="id, title, path, note…" class="h-8" />
    </label>
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-muted-foreground">Type</span>
      <select bind:value={type} class="border-input bg-background h-8 rounded-md border px-2 text-sm">
        <option value="">Every type</option>
        {#each types as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    </label>
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-muted-foreground">Source</span>
      <select bind:value={source} class="border-input bg-background h-8 rounded-md border px-2 text-sm">
        <option value="">Every source</option>
        {#each sources as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    </label>
    <fieldset class="flex flex-col gap-1 text-xs">
      <legend class="text-muted-foreground mb-1">Observed between</legend>
      <span class="flex items-center gap-1">
        <input type="date" bind:value={from} aria-label="Observed from" class="border-input bg-background h-8 rounded-md border px-2 text-sm" />
        <span class="text-muted-foreground">–</span>
        <input type="date" bind:value={to} aria-label="Observed to" class="border-input bg-background h-8 rounded-md border px-2 text-sm" />
      </span>
    </fieldset>
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-muted-foreground">Assessment</span>
      <select bind:value={assessment} class="border-input bg-background h-8 rounded-md border px-2 text-sm">
        <option value="any">Any confidence</option>
        <option value="high">High (80%+)</option>
        <option value="medium">Medium (50-79%)</option>
        <option value="low">Low (under 50%)</option>
        <option value="unevidenced">Unevidenced</option>
      </select>
    </label>
    {#if filtered}<Button variant="ghost" size="sm" onclick={clear}>Clear</Button>{/if}
  </div>

  <p class="text-muted-foreground border-b px-4 py-1.5 text-xs" aria-live="polite">
    {count} of {total} {rows === 'exhibits' ? (total === 1 ? 'exhibit' : 'exhibits') : total === 1 ? 'observation' : 'observations'}
    {#if count > SHOWN}- showing the first {SHOWN}; narrow the filters to see the rest{/if}
    {#if from || to}· dates are when evidence was observed{/if}
  </p>

  <div class="min-h-0 flex-1 overflow-auto">
    {#if count === 0}
      <div class="text-muted-foreground p-6 text-sm">
        {#if total === 0}
          {rows === 'exhibits' ? 'No exhibits on file.' : 'No evidence on file: no exhibit records where it was seen.'}
        {:else}
          Nothing matches these filters.
        {/if}
      </div>
    {:else if rows === 'exhibits'}
      <table class="w-full border-collapse text-sm">
        <thead class="bg-background text-muted-foreground sticky top-0 z-10 text-left text-xs shadow-[0_1px_0_var(--border)]">
          <tr>
            {@render sortHeader('Exhibit', exhibitSort.key === 'title', exhibitSort.down, () => (exhibitSort = { key: 'title', down: exhibitSort.key === 'title' && !exhibitSort.down }))}
            {@render sortHeader('Type', exhibitSort.key === 'type', exhibitSort.down, () => (exhibitSort = { key: 'type', down: exhibitSort.key === 'type' && !exhibitSort.down }))}
            <th scope="col" class="px-3 py-2 font-medium">Sources</th>
            {@render sortHeader('Confidence', exhibitSort.key === 'confidence', exhibitSort.down, () => (exhibitSort = { key: 'confidence', down: !(exhibitSort.key === 'confidence' && exhibitSort.down) }))}
            {@render sortHeader('Evidence', exhibitSort.key === 'evidence', exhibitSort.down, () => (exhibitSort = { key: 'evidence', down: !(exhibitSort.key === 'evidence' && exhibitSort.down) }))}
            {@render sortHeader('Last observed', exhibitSort.key === 'observed', exhibitSort.down, () => (exhibitSort = { key: 'observed', down: !(exhibitSort.key === 'observed' && exhibitSort.down) }))}
            {@render sortHeader('File', exhibitSort.key === 'path', exhibitSort.down, () => (exhibitSort = { key: 'path', down: exhibitSort.key === 'path' && !exhibitSort.down }))}
          </tr>
        </thead>
        <tbody>
          {#each exhibits.slice(0, SHOWN) as row (row.entity.id)}
            <tr class="hover:bg-muted/60 border-b align-top {row.entity.id === selected ? 'bg-accent' : ''}">
              <td class="px-3 py-2">
                <button type="button" class="flex min-w-0 items-center gap-2 text-left hover:underline" onclick={() => onselect(row.entity.id)}>
                  <TypeMark type={row.entity.type} size="sm" />
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate font-medium">{row.entity.title}</span>
                    <span class="text-muted-foreground truncate font-mono text-xs">{row.entity.id}</span>
                  </span>
                </button>
              </td>
              <td class="text-muted-foreground px-3 py-2 text-xs">{row.entity.type.replaceAll('_', ' ')}</td>
              <td class="px-3 py-2">
                <span class="flex flex-wrap gap-1">
                  {#each row.sources as item (item)}<Badge variant="secondary" class="font-mono text-[10px]">{item}</Badge>{/each}
                </span>
              </td>
              <td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums">
                {#if row.confidence !== undefined}
                  {Math.round(row.confidence * 100)}%
                  <span class="text-muted-foreground" title={row.basis ? basisLabel(row.basis) : undefined}>
                    {row.basis === 'unevidenced' ? 'unevidenced' : bandOf(row.confidence)}
                  </span>
                {:else}<span class="text-muted-foreground">—</span>{/if}
              </td>
              <td class="px-3 py-2 text-xs tabular-nums">{row.evidenceCount}</td>
              <td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums">{row.lastObserved ?? '—'}</td>
              <td class="text-muted-foreground max-w-64 truncate px-3 py-2 font-mono text-xs" title={row.entity.path}>{row.entity.path}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <table class="w-full border-collapse text-sm">
        <thead class="bg-background text-muted-foreground sticky top-0 z-10 text-left text-xs shadow-[0_1px_0_var(--border)]">
          <tr>
            {@render sortHeader('Exhibit', observationSort.key === 'title', observationSort.down, () => (observationSort = { key: 'title', down: observationSort.key === 'title' && !observationSort.down }))}
            <th scope="col" class="px-3 py-2 font-medium">About</th>
            {@render sortHeader('Source', observationSort.key === 'source', observationSort.down, () => (observationSort = { key: 'source', down: observationSort.key === 'source' && !observationSort.down }))}
            {@render sortHeader('Where', observationSort.key === 'location', observationSort.down, () => (observationSort = { key: 'location', down: observationSort.key === 'location' && !observationSort.down }))}
            {@render sortHeader('Observed (observedAt)', observationSort.key === 'observed', observationSort.down, () => (observationSort = { key: 'observed', down: !(observationSort.key === 'observed' && observationSort.down) }))}
            {@render sortHeader('Happened (eventAt)', observationSort.key === 'event', observationSort.down, () => (observationSort = { key: 'event', down: !(observationSort.key === 'event' && observationSort.down) }))}
          </tr>
        </thead>
        <tbody>
          {#each observations.slice(0, SHOWN) as row (row.key)}
            <tr class="hover:bg-muted/60 border-b align-top {row.entity.id === selected ? 'bg-accent' : ''}">
              <td class="px-3 py-2">
                <button type="button" class="flex min-w-0 items-center gap-2 text-left hover:underline" onclick={() => onselect(row.entity.id)}>
                  <TypeMark type={row.entity.type} size="sm" />
                  <span class="truncate">{row.entity.title}</span>
                </button>
              </td>
              <td class="text-muted-foreground px-3 py-2 text-xs">
                {#if row.link}
                  <span class="inline-flex items-center gap-1"><span class="font-mono">{row.link.rel}</span><ArrowRight class="size-3" />{titleOf(row.link.target)}</span>
                {:else}the exhibit{/if}
                {#if typeof row.evidence.note === 'string'}<p class="text-foreground mt-0.5 break-words">{row.evidence.note}</p>{/if}
              </td>
              <td class="px-3 py-2">{#if row.source}<Badge variant="outline" class="font-mono text-[10px]">{row.source}</Badge>{/if}</td>
              <td class="max-w-72 px-3 py-2 font-mono text-xs break-all">{row.location || '—'}</td>
              <td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums">{dayOf(row.observedAt) ?? '—'}</td>
              <td class="px-3 py-2 text-xs whitespace-nowrap tabular-nums">{row.eventAt ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
