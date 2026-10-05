<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Copy from '@lucide/svelte/icons/copy'
  import FileText from '@lucide/svelte/icons/file-text'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Separator } from '$lib/components/ui/separator/index.js'
  import { confidenceOf, evidenceOf, isUrl, linksOf, provenanceOf } from '$lib/model.js'
  import type { UiEdge, UiEntity, UiGraph } from '$lib/types.js'
  import Notes from './notes.svelte'
  import Value from './value.svelte'

  interface Props {
    graph: UiGraph
    entity: UiEntity
    colourOf: (type: string) => string
    onselect: (id: string) => void
  }

  let { graph, entity, colourOf, onselect }: Props = $props()

  const byId = $derived(new Map(graph.entities.map((item) => [item.id, item])))
  const links = $derived(linksOf(graph, entity.id))
  const provenance = $derived(provenanceOf(entity))
  const confidence = $derived(confidenceOf(provenance.confidence))
  const evidence = $derived(evidenceOf(entity))
  /** Provenance fields beyond the three every file may carry. */
  const otherProvenance = $derived(
    Object.entries(provenance).filter(([key]) => !['authority', 'confidence', 'capturedBy', 'evidence'].includes(key))
  )
  const attributes = $derived(Object.entries(entity.attributes))
  /** Frontmatter docket does not model - shown so nothing a file says is hidden. */
  const extraFrontmatter = $derived(
    Object.entries(entity.frontmatter).filter(
      ([key]) => !['id', 'type', 'title', 'tags', 'attributes', 'links', 'provenance', 'index', 'evidence'].includes(key)
    )
  )

  const confidenceLabel = (value: number): string => (value >= 0.8 ? 'high' : value >= 0.5 ? 'medium' : 'low')

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text)
  }

  const ends = (edge: UiEdge, direction: 'out' | 'in') => {
    const id = direction === 'out' ? edge.target : edge.source
    return { id, entity: byId.get(id) }
  }
</script>

<div class="flex flex-col gap-5 p-4">
  <header class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <span class="size-2.5 shrink-0 rounded-full" style="background: {colourOf(entity.type)}"></span>
      <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{entity.type}</span>
    </div>
    <h2 class="text-lg leading-snug font-semibold">{entity.title}</h2>
    <div class="flex items-center gap-1">
      <code class="bg-muted truncate rounded px-1.5 py-0.5 font-mono text-xs">{entity.id}</code>
      <Button variant="ghost" size="icon-xs" aria-label="Copy id" onclick={() => copy(entity.id)}><Copy /></Button>
    </div>
    <div class="text-muted-foreground flex items-center gap-1.5 text-xs">
      <FileText class="size-3.5 shrink-0" />
      <span class="truncate font-mono" title={entity.path}>{entity.path}</span>
    </div>
    {#if entity.tags.length > 0}
      <div class="flex flex-wrap gap-1">
        {#each entity.tags as tag, index (index)}<Badge variant="secondary">{tag}</Badge>{/each}
      </div>
    {/if}
  </header>

  {#if Object.keys(provenance).length > 0 || evidence.length > 0}
    <section class="flex flex-col gap-2">
      <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Provenance</h3>
      <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
        {#if provenance.authority !== undefined}
          <dt class="text-muted-foreground">Authority</dt>
          <dd><Value value={provenance.authority} /></dd>
        {/if}
        {#if confidence !== null}
          <dt class="text-muted-foreground">Confidence</dt>
          <dd class="flex items-center gap-2">
            <span class="bg-muted h-1.5 w-24 overflow-hidden rounded-full" aria-hidden="true">
              <span class="bg-foreground/70 block h-full rounded-full" style="width: {confidence * 100}%"></span>
            </span>
            <span class="tabular-nums">{Math.round(confidence * 100)}%</span>
            <span class="text-muted-foreground text-xs">{confidenceLabel(confidence)}</span>
          </dd>
        {/if}
        {#if provenance.capturedBy !== undefined}
          <dt class="text-muted-foreground">Captured by</dt>
          <dd><Value value={provenance.capturedBy} /></dd>
        {/if}
        {#each otherProvenance as [key, value] (key)}
          <dt class="text-muted-foreground">{key}</dt>
          <dd class="min-w-0"><Value {value} /></dd>
        {/each}
      </dl>
      {#if evidence.length > 0}
        <div class="flex flex-col gap-1.5">
          <div class="text-muted-foreground text-xs">Evidence ({evidence.length})</div>
          <ul class="flex flex-col gap-1.5">
            {#each evidence as item, index (index)}
              <li class="bg-muted/50 rounded-md border px-2.5 py-1.5 text-xs">
                {#if typeof item === 'string'}
                  {#if isUrl(item)}
                    <a class="break-all underline underline-offset-2" href={item} target="_blank" rel="noreferrer">{item}</a>
                  {:else}
                    <span class="break-words">{item}</span>
                  {/if}
                {:else}
                  <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                    {#each Object.entries(item) as [key, value] (key)}
                      <dt class="text-muted-foreground">{key}</dt>
                      <dd class="min-w-0"><Value {value} /></dd>
                    {/each}
                  </dl>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  {:else}
    <p class="text-muted-foreground text-xs">No provenance recorded: the file does not say where this came from.</p>
  {/if}

  {#if attributes.length > 0}
    <section class="flex flex-col gap-2">
      <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Attributes</h3>
      <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
        {#each attributes as [key, value] (key)}
          <dt class="text-muted-foreground font-mono text-xs">{key}</dt>
          <dd class="min-w-0"><Value {value} /></dd>
        {/each}
      </dl>
    </section>
  {/if}

  {#snippet linkList(title: string, edges: UiEdge[], direction: 'out' | 'in')}
    <section class="flex flex-col gap-2">
      <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title} ({edges.length})</h3>
      {#if edges.length === 0}
        <p class="text-muted-foreground text-xs">None.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each edges as edge, index (index)}
            {@const end = ends(edge, direction)}
            <li>
              <button
                type="button"
                class="hover:bg-muted flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onclick={() => onselect(end.id)}
              >
                {#if direction === 'out'}
                  <ArrowRight class="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                {:else}
                  <ArrowLeft class="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                {/if}
                <span class="flex min-w-0 flex-col">
                  <span class="text-muted-foreground font-mono text-xs">{edge.rel}</span>
                  <span class="flex items-center gap-1.5">
                    <span
                      class="size-2 shrink-0 rounded-full {end.entity ? '' : 'border border-dashed'}"
                      style={end.entity ? `background: ${colourOf(end.entity.type)}` : 'border-color: var(--graph-other)'}
                    ></span>
                    <span class="truncate">{end.entity?.title ?? end.id}</span>
                    {#if !end.entity}<Badge variant="outline" class="text-[10px]">unresolved</Badge>{/if}
                  </span>
                  {#if edge.attributes && Object.keys(edge.attributes).length > 0}
                    <span class="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs">
                      {#each Object.entries(edge.attributes) as [key, value] (key)}
                        <span>{key}: <Value {value} inline /></span>
                      {/each}
                    </span>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/snippet}

  {@render linkList('Links out', links.outgoing, 'out')}
  {@render linkList('Links in', links.incoming, 'in')}

  {#if entity.content.trim().length > 0}
    <Separator />
    <section class="flex flex-col gap-2">
      <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Notes</h3>
      <Notes content={entity.content} titleOf={(id) => byId.get(id)?.title} {onselect} />
    </section>
  {/if}

  {#if extraFrontmatter.length > 0}
    <section class="flex flex-col gap-2">
      <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Other frontmatter</h3>
      <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
        {#each extraFrontmatter as [key, value] (key)}
          <dt class="text-muted-foreground font-mono text-xs">{key}</dt>
          <dd class="min-w-0"><Value {value} /></dd>
        {/each}
      </dl>
    </section>
  {/if}

  <details class="text-sm">
    <summary class="text-muted-foreground cursor-pointer text-xs font-medium tracking-wide uppercase">Raw frontmatter</summary>
    <pre class="bg-muted mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs">{JSON.stringify(entity.frontmatter, null, 2)}</pre>
  </details>
</div>
