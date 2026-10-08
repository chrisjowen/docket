<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Check from '@lucide/svelte/icons/check'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import Eye from '@lucide/svelte/icons/eye'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Scale from '@lucide/svelte/icons/scale'
  import Search from '@lucide/svelte/icons/search'
  import Square from '@lucide/svelte/icons/square'
  import X from '@lucide/svelte/icons/x'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Checkbox } from '$lib/components/ui/checkbox/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import { casebookOf } from '$lib/ask/evidence.js'
  import { compareMetrics } from '$lib/ask/outcome.js'
  import type { UiGraph } from '$lib/types.js'
  import { getWorkspace, type BoardScope } from '$lib/workspace.svelte.js'
  import AdapterSection from './adapter-section.svelte'
  import SynthesisCard from './synthesis-card.svelte'
  import { evidenceLabel, setAskView } from './view.js'

  let { graph }: { graph: UiGraph } = $props()

  const workspace = getWorkspace()
  const session = workspace.ask

  const casebook = $derived(casebookOf(graph))
  setAskView({
    get casebook() {
      return casebook
    },
    label: evidenceLabel
  })

  onMount(() => {
    void workspace.loadAdapters()
  })

  const listed = $derived(workspace.adapters?.state === 'ready' ? workspace.adapters.response : null)
  const queryable = $derived(listed?.adapters.filter((adapter) => adapter.roles.includes('query')) ?? [])
  const defaults = $derived(listed?.query.defaultAdapters ?? [])
  const chosen = $derived(new Set(session.adapters ?? defaults))

  function toggle(id: string, on: boolean): void {
    const next = queryable.map((adapter) => adapter.id).filter((other) => (other === id ? on : chosen.has(other)))
    const isDefault = next.length === defaults.length && next.every((other) => defaults.includes(other))
    session.adapters = isDefault ? null : next
  }

  const outcome = $derived(session.outcome)
  const comparisons = $derived(outcome ? compareMetrics(outcome) : [])
  const titleOf = (id: string): string => graph.entities.find((entity) => entity.id === id)?.title ?? id

  /** Adapters being asked right now, when the server says which they will be. */
  const asking = $derived(session.pending ? (session.pending.adapters ?? (listed ? defaults : null)) : null)

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    const question = session.question.trim()
    if (question === '' || (session.adapters !== null && session.adapters.length === 0)) return
    void session.ask(question)
  }

  async function onboard(scope: BoardScope): Promise<void> {
    await goto(resolve('/'))
    workspace.showScope(scope)
  }

  const connectionsScope = $derived.by((): BoardScope | null => {
    if (!outcome || outcome.connections.length === 0) return null
    return {
      label: `the canonical paths joining what was found for “${outcome.question}”`,
      ids: [...new Set(outcome.connections.flatMap((path) => path.nodes))],
      links: outcome.connections.flatMap((path) =>
        path.steps.map((step, index) => {
          const [a, b] = [path.nodes[index] ?? '', path.nodes[index + 1] ?? '']
          return step.forward ? { source: a, rel: step.rel, target: b } : { source: b, rel: step.rel, target: a }
        })
      )
    }
  })

  /** Paths listed before "show all": the results come first. */
  const CONNECTIONS_SHOWN = 5
  let allConnections = $state(false)

  const EXAMPLES = ['Why is order state in Postgres?', 'What does checkout depend on?', 'Who owns the orders service?']
</script>

<div class="h-full min-h-0 overflow-y-auto">
  <div class="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6">
    <form class="flex flex-col gap-2.5" onsubmit={submit}>
      <label for="ask-question" class="font-serif text-xl font-semibold">Ask the adapters</label>
      <div class="flex gap-2">
        <Input
          id="ask-question"
          bind:value={session.question}
          placeholder="How many times was orders deployed in the last four weeks?"
          autocomplete="off"
          class="h-10 text-base"
        />
        {#if session.pending}
          <Button type="button" variant="outline" size="lg" onclick={() => session.cancel()}><Square /> Cancel</Button>
        {:else}
          <Button type="submit" size="lg" disabled={session.question.trim() === '' || (session.adapters !== null && session.adapters.length === 0)}>
            <Search /> Ask
          </Button>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label class="flex items-center gap-1.5">
          <Checkbox bind:checked={session.synthesis} />
          Summarise the results with a model
        </label>
        {#if queryable.length > 0}
          <fieldset class="flex flex-wrap items-center gap-1.5">
            <legend class="text-muted-foreground float-left mr-1">Ask</legend>
            {#each queryable as adapter (adapter.id)}
              <label
                class="flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-1 {chosen.has(adapter.id) ? 'bg-accent' : 'text-muted-foreground'}"
                title={adapter.status ? `${adapter.status.state}: ${adapter.status.message}` : adapter.module}
              >
                <Checkbox checked={chosen.has(adapter.id)} onCheckedChange={(on) => toggle(adapter.id, on === true)} class="size-3.5" />
                <span class="font-mono">{adapter.id}</span>
                {#if adapter.status?.state === 'unavailable'}<span class="text-destructive">· unavailable</span>{/if}
              </label>
            {/each}
            {#if session.adapters !== null}
              <Button variant="ghost" size="xs" onclick={() => (session.adapters = null)}>Use the defaults</Button>
            {/if}
          </fieldset>
        {:else if workspace.adapters && workspace.adapters.state !== 'ready'}
          <span class="text-muted-foreground">Asks every adapter configured for query in <code class="font-mono">.docket.yaml</code>.</span>
        {/if}
      </div>
      <p class="text-muted-foreground text-xs">
        Each adapter answers in its own way - search hits, passages, facts, counts, graphs - and each answer is shown as it came,
        with its evidence. To find an exhibit by name in the loaded files instead, use <span class="font-medium">Find in the casebook</span>
        at the top.
      </p>
    </form>

    {#if session.pending}
      <div class="flex flex-col gap-2 rounded-md border p-3 text-sm" role="status" aria-live="polite">
        <p class="flex items-center gap-2 font-serif italic"><LoaderCircle class="size-4 animate-spin" /> Asking “{session.pending.question}”…</p>
        {#if asking}
          <ul class="flex flex-wrap gap-1.5 text-xs">
            {#each asking as id (id)}
              <li class="text-muted-foreground flex items-center gap-1 rounded-full border px-2 py-0.5">
                <LoaderCircle class="size-3 animate-spin" /> <span class="font-mono">{id}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if session.failure}
      <div class="border-destructive/40 text-destructive flex gap-2 rounded-md border p-3 text-sm">
        <CircleAlert class="mt-0.5 size-4 shrink-0" />
        <span class="break-words">{session.failure}</span>
      </div>
    {/if}

    {#if outcome}
      <div class="flex flex-col gap-5 transition-opacity {session.pending ? 'opacity-50' : ''}">
        <div class="flex flex-col gap-2">
          <p class="flex gap-2.5"><span class="text-gilt font-serif font-semibold">Q.</span><span class="font-serif text-lg italic">{outcome.question}</span></p>
          <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="Adapters asked">
            {#each outcome.results as result (result.adapter)}
              <li>
                <a
                  href="#adapter-{result.adapter}"
                  onclick={(event) => {
                    event.preventDefault()
                    document.getElementById(`adapter-${result.adapter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  class="hover:bg-muted flex items-center gap-1 rounded-full border px-2 py-0.5 {result.state === 'failed' ? 'border-destructive/50 text-destructive' : ''}"
                >
                  {#if result.state === 'failed'}<X class="size-3" />{:else}<Check class="size-3 text-emerald-600" />{/if}
                  <span class="font-mono">{result.adapter}</span>
                  <span class="text-muted-foreground">
                    {result.state === 'failed'
                      ? result.error.code
                      : `${result.blocks.length} ${result.blocks.length === 1 ? 'result' : 'results'}`}
                  </span>
                </a>
              </li>
            {:else}
              <li class="text-muted-foreground">No adapter is configured to answer questions.</li>
            {/each}
          </ul>
          {#if outcome.via !== 'coordinator'}
            <p class="text-muted-foreground text-xs">
              Answered through <code class="font-mono">docket search</code>{outcome.via === 'legacy-chat' ? ' and chat' : ''}: this docket does
              not serve the adapter coordinator yet, so each adapter's answer is its exhibit hits.
            </p>
          {/if}
          {#each outcome.diagnostics as diagnostic, index (index)}
            <p class="flex items-start gap-1.5 text-xs {diagnostic.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}">
              <CircleAlert class="mt-px size-3.5 shrink-0" /><span class="break-words">{diagnostic.message}</span>
            </p>
          {/each}
        </div>

        <SynthesisCard {outcome} />

        {#each comparisons as comparison (comparison.label)}
          <section
            class="flex flex-col gap-2 rounded-lg border p-4 {comparison.agree ? '' : 'border-amber-500/50 bg-amber-500/5'}"
            aria-label="Adapters compared on {comparison.label}"
          >
            <h3 class="flex items-center gap-1.5 text-sm font-medium">
              <Scale class="size-4" />
              {comparison.agree ? 'Adapters agree' : 'Adapters disagree'}: {comparison.label}
            </h3>
            <ul class="flex flex-wrap gap-3">
              {#each comparison.readings as reading (reading.blockId)}
                <li class="bg-background flex flex-col rounded-md border px-3 py-2">
                  <span class="font-serif text-2xl font-semibold tabular-nums">
                    {reading.value.toLocaleString()} <span class="text-muted-foreground text-sm font-normal">{reading.unit ?? ''}</span>
                  </span>
                  <span class="text-muted-foreground text-xs">
                    <span class="font-mono">{reading.adapter}</span> ·
                    {reading.coverage === 'exhaustive' ? 'exhaustive' : reading.coverage === 'top-k' ? 'from a sample - not a full count' : 'coverage unknown'}
                  </span>
                </li>
              {/each}
            </ul>
            {#if !comparison.agree}
              <p class="text-muted-foreground text-xs">Shown side by side, not averaged: each adapter counted differently. Check each one's evidence below.</p>
            {/if}
          </section>
        {/each}

        {#each outcome.results as result (result.adapter)}
          <AdapterSection {result} {onboard} />
        {/each}

        {#if outcome.connections.length > 0 && connectionsScope}
          {@const scope = connectionsScope}
          <section class="flex flex-col gap-2 rounded-lg border p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="section-title">How they connect</h3>
              <span class="text-muted-foreground text-xs">relationships in the canonical files, between what the adapters found</span>
              <Button variant="ghost" size="xs" class="ml-auto" onclick={() => onboard(scope)}><Eye /> Show on the board</Button>
            </div>
            <ul class="flex flex-col gap-1.5">
              {#each allConnections ? outcome.connections : outcome.connections.slice(0, CONNECTIONS_SHOWN) as path, index (index)}
                <li class="flex flex-wrap items-center gap-1 text-xs">
                  {#each path.nodes as id, step (step)}
                    <button type="button" class="hover:bg-muted rounded px-1 py-0.5 font-medium" onclick={() => workspace.select(id)}>{titleOf(id)}</button>
                    {#if path.steps[step]}
                      {@const link = path.steps[step]}
                      <span class="text-muted-foreground inline-flex items-center gap-0.5 font-mono">
                        {#if !link.forward}<ArrowLeft class="size-3" />{/if}{link.rel}{#if link.forward}<ArrowRight class="size-3" />{/if}
                      </span>
                    {/if}
                  {/each}
                </li>
              {/each}
            </ul>
            {#if outcome.connections.length > CONNECTIONS_SHOWN}
              <Button variant="ghost" size="xs" class="self-start" onclick={() => (allConnections = !allConnections)}>
                {allConnections ? 'Show fewer' : `Show all ${outcome.connections.length} paths`}
              </Button>
            {/if}
          </section>
        {/if}
      </div>
    {:else if !session.pending}
      <div class="text-muted-foreground flex flex-col gap-2 rounded-lg border border-dashed p-5 text-sm">
        <p class="text-foreground font-serif text-lg">Put a question to every configured adapter</p>
        <p>Results fill this page: exhibits, passages, facts, counts, tables, timelines and graphs, each linked to its evidence.</p>
        <div class="flex flex-wrap gap-1.5">
          {#each EXAMPLES as example (example)}
            <Button variant="outline" size="xs" onclick={() => (session.question = example)}>{example}</Button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
