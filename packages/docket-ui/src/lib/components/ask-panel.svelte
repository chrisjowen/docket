<script lang="ts">
  import { untrack } from 'svelte'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Search from '@lucide/svelte/icons/search'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import type { UiAnswer, UiGraph } from '$lib/types.js'
  import TypeMark from './type-mark.svelte'

  interface Props {
    graph: UiGraph
    onselect: (id: string) => void
    /** Called with each new answer, or null when it is cleared. */
    onanswer: (answer: UiAnswer | null) => void
    /** The last answer, kept by the page so switching tabs does not lose it. */
    answer: UiAnswer | null
  }

  let { graph, onselect, onanswer, answer }: Props = $props()

  // Starts from the kept answer; edits are the viewer's own from then on.
  let question = $state(untrack(() => answer?.query ?? ''))
  let loading = $state(false)
  let failure = $state<string | null>(null)

  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))
  const title = (id: string): string => byId.get(id)?.title ?? id

  /** Found entities, best first: the order the sources ranked them. */
  const ranked = $derived.by(() => {
    if (!answer) return []
    const order = [...new Set(answer.sources.flatMap((source) => source.hits.map((hit) => hit.id)))]
    const documents = new Map(answer.documents.map((document) => [document.id, document]))
    return order.flatMap((id) => {
      const document = documents.get(id)
      return document ? [document] : []
    })
  })

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const query = question.trim()
    if (!query) return
    loading = true
    failure = null
    try {
      const response = await fetch(`/api/ask?q=${encodeURIComponent(query)}`)
      const body = (await response.json()) as UiAnswer | { error: string }
      if (!response.ok || 'error' in body) throw new Error('error' in body ? body.error : response.statusText)
      onanswer(body)
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause)
      onanswer(null)
    } finally {
      loading = false
    }
  }
</script>

<div class="flex flex-col gap-4 p-4">
  <form class="flex flex-col gap-2" onsubmit={submit}>
    <label for="ask" class="section-title">Ask the casebook</label>
    <div class="flex gap-2">
      <Input id="ask" bind:value={question} placeholder="What does checkout depend on?" autocomplete="off" />
      <Button type="submit" disabled={loading || question.trim() === ''}>
        {#if loading}<LoaderCircle class="animate-spin" />{:else}<Search />{/if}
        Ask
      </Button>
    </div>
    <p class="text-muted-foreground text-xs">
      Answered by <code class="font-mono">docket search</code> - every searchable projection in
      <code class="font-mono">.docket.yaml</code>, the same search agents use - with the relationships joining what it finds.
      The board then shows only the exhibits the answer cites.
    </p>
  </form>

  {#if failure}
    <div class="border-destructive/40 text-destructive flex gap-2 rounded-md border p-3 text-sm">
      <CircleAlert class="mt-0.5 size-4 shrink-0" />
      <span>{failure}</span>
    </div>
  {/if}

  {#if answer}
    {#if !answer.index.synced || answer.index.behind > 0}
      <div class="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        <CircleAlert class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>
          {#if !answer.index.synced}
            The search index has not been synced, so search may find nothing.
          {:else}
            {answer.index.behind} {answer.index.behind === 1 ? 'file has' : 'files have'} changed since the last sync; search may miss
            {answer.index.behind === 1 ? 'it' : 'them'}.
          {/if}
          Run <code class="font-mono">docket sync</code>, then ask again.
        </span>
      </div>
    {/if}

    <section class="flex flex-col gap-2">
      <h3 class="section-title">Exhibits found ({ranked.length})</h3>
      {#if ranked.length === 0}
        <p class="text-muted-foreground text-sm">Nothing matched “{answer.query}”.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each ranked as document (document.id)}
            <li>
              <button
                type="button"
                class="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                onclick={() => onselect(document.id)}
              >
                <TypeMark type={document.type} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">{document.title}</span>
                  <span class="text-muted-foreground truncate font-mono text-xs">{document.id}</span>
                </span>
                {#each document.foundBy as source (source)}
                  <Badge variant="outline" class="shrink-0 text-[10px]">{source}</Badge>
                {/each}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if answer.paths.length > 0}
      <section class="flex flex-col gap-2">
        <h3 class="section-title">How they connect</h3>
        <ul class="flex flex-col gap-2">
          {#each answer.paths as path, index (index)}
            <li class="flex flex-wrap items-center gap-1 rounded-md border px-2 py-1.5 text-xs">
              {#each path.nodes as id, step (step)}
                <button type="button" class="hover:bg-muted rounded px-1 py-0.5 font-medium" onclick={() => onselect(id)}>
                  {title(id)}
                </button>
                {#if path.steps[step]}
                  {@const link = path.steps[step]}
                  <span class="text-muted-foreground inline-flex items-center gap-0.5 font-mono">
                    {#if !link.forward}<ArrowLeft class="size-3" />{/if}
                    {link.rel}
                    {#if link.forward}<ArrowRight class="size-3" />{/if}
                  </span>
                {/if}
              {/each}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="flex flex-col gap-2">
      <h3 class="section-title">By source</h3>
      {#if answer.sources.length === 0}
        <p class="text-muted-foreground text-sm">No configured projection can search.</p>
      {/if}
      {#each answer.sources as source (source.name)}
        <div class="flex flex-col gap-1.5 rounded-md border p-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-xs font-medium">{source.name}</span>
            <span class="text-muted-foreground text-xs">
              {source.error ? 'unavailable' : `${source.hits.length} ${source.hits.length === 1 ? 'hit' : 'hits'}`}
            </span>
          </div>
          {#if source.error}
            <p class="text-destructive text-xs break-words">{source.error}</p>
          {/if}
          {#if source.note}
            <details>
              <summary class="text-muted-foreground cursor-pointer text-xs">How it read the question</summary>
              <pre class="bg-muted mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap">{source.note}</pre>
            </details>
          {/if}
          {#if source.hits.length > 0}
            <ol class="flex flex-col gap-0.5">
              {#each source.hits as hit (hit.id)}
                <li class="flex flex-col text-xs">
                  <button type="button" class="hover:bg-muted flex items-center gap-2 rounded px-1 py-0.5 text-left" onclick={() => onselect(hit.id)}>
                    <span class="min-w-0 flex-1 truncate">{title(hit.id)}</span>
                    {#if hit.score !== undefined}
                      <span class="text-muted-foreground tabular-nums">{hit.score.toFixed(2)}</span>
                    {/if}
                  </button>
                  {#if hit.detail}<span class="text-muted-foreground px-1 font-mono text-[11px] break-words">{hit.detail}</span>{/if}
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
</div>
