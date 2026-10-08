<script lang="ts">
  import type { RetrievedEvidence } from '@docket/contracts'
  import Check from '@lucide/svelte/icons/check'
  import FileText from '@lucide/svelte/icons/file-text'
  import X from '@lucide/svelte/icons/x'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Separator } from '$lib/components/ui/separator/index.js'
  import { casebookOf, isDerived, referenceLocation, resolves, STANDING_DETAIL, standingOf } from '$lib/ask/evidence.js'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import type { UiGraph } from '$lib/types.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import TypeMark from '../type-mark.svelte'
  import StandingBadge from './standing-badge.svelte'
  import { evidenceLabel } from './view.js'

  /**
   * One piece of evidence: its text, where it is on record and at which
   * revision, how it was derived, and which adapter returned it reading the
   * question how.
   */
  let { graph, evidence, result }: { graph: UiGraph; evidence: RetrievedEvidence; result: AnsweredResult } = $props()

  const workspace = getWorkspace()
  const casebook = $derived(casebookOf(graph))
  const byId = $derived(new Map(graph.entities.map((entity) => [entity.id, entity])))
  const byPath = $derived(new Map(graph.entities.flatMap((entity) => entity.paths.map((path) => [path, entity] as const))))
  const standing = $derived(standingOf(evidence, casebook))
  const interpretation = $derived(result.answer.interpretation)
  const coverage = $derived(result.answer.coverage)
  /** The blocks that cite it, so the inspector says where it was used. */
  const usedIn = $derived(
    result.blocks.filter((shown) => {
      if (shown.block.evidenceIds.includes(evidence.id)) return true
      if (!shown.known) return false
      const block = shown.block
      if (block.kind === 'table') return block.rows.some((row) => row.evidenceIds?.includes(evidence.id))
      if (block.kind === 'graph') return block.edges.some((edge) => edge.evidenceIds?.includes(evidence.id))
      if (block.kind === 'timeline') return block.events.some((event) => event.evidenceIds?.includes(evidence.id))
      return false
    })
  )
</script>

<div class="flex flex-col gap-5 p-4">
  <header class="flex flex-col gap-2">
    <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
      <span>Evidence {evidenceLabel(result, evidence.id)}, {evidence.kind.replace('-', ' ')}</span>
      <StandingBadge {standing} />
    </div>
    {#if isDerived(evidence)}
      <p class="font-serif text-lg leading-snug break-words">{evidence.text}</p>
    {:else}
      <blockquote class="border-gilt border-l-2 pl-3 font-serif text-lg leading-snug break-words whitespace-pre-wrap">{evidence.text}</blockquote>
    {/if}
    <p class="text-muted-foreground text-xs">{STANDING_DETAIL[standing]}</p>
  </header>

  <section class="flex flex-col gap-2">
    <h3 class="section-title">Canonical location</h3>
    {#if evidence.canonicalRefs.length === 0}
      <p class="text-muted-foreground text-sm">The adapter gave no canonical reference, so this cannot be checked against the files.</p>
    {:else}
      <ul class="flex flex-col gap-1.5">
        {#each evidence.canonicalRefs as reference, index (index)}
          {@const found = resolves(reference, casebook)}
          {@const entity = reference.kind === 'entity' ? byId.get(reference.id) : reference.span ? byPath.get(reference.span.path) : undefined}
          <li class="bg-muted/50 flex flex-col gap-1 rounded-md border px-2.5 py-2 text-xs">
            <span class="flex items-center gap-1.5">
              {#if found}<Check class="size-3.5 text-emerald-600" aria-label="resolves" />{:else}<X class="text-muted-foreground size-3.5" aria-label="does not resolve" />{/if}
              <Badge variant="outline" class="font-mono text-[10px]">{reference.kind}</Badge>
              <code class="min-w-0 font-mono break-all">{reference.id}</code>
            </span>
            {#if reference.span || reference.revision}
              <span class="flex items-center gap-1.5 pl-5">
                <FileText class="size-3 shrink-0" />
                <span class="font-mono break-all">{referenceLocation(reference)}</span>
              </span>
            {/if}
            {#if reference.span?.startLine !== undefined}
              <span class="text-muted-foreground pl-5">Lines refer to revision {reference.revision}.</span>
            {/if}
            {#if entity}
              <button type="button" class="hover:bg-muted ml-4 flex items-center gap-1.5 self-start rounded px-1 py-0.5" onclick={() => workspace.select(entity.id)}>
                <TypeMark type={entity.type} size="sm" />
                <span class="underline-offset-2 hover:underline">Open the exhibit: {entity.title}</span>
              </button>
            {:else if !found}
              <span class="text-muted-foreground pl-5">Not in the loaded casebook.</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-2">
    <h3 class="section-title">Record</h3>
    <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
      <dt class="text-muted-foreground">Adapter</dt>
      <dd class="font-mono text-xs">{result.adapter}</dd>
      {#if evidence.nativeId}
        <dt class="text-muted-foreground">Native id</dt>
        <dd class="font-mono text-xs break-all">{evidence.nativeId}</dd>
      {/if}
      <dt class="text-muted-foreground">Derivation</dt>
      <dd>
        {#if evidence.derivation}
          derived by <code class="font-mono text-xs">{evidence.derivation.engine}</code>{#if evidence.derivation.model}, model
            <code class="font-mono text-xs">{evidence.derivation.model}</code>{/if}
        {:else if evidence.kind === 'derived-fact'}
          derived; the adapter does not say how
        {:else}
          retrieved as recorded, not derived
        {/if}
      </dd>
      {#if evidence.eventAt}
        <dt class="text-muted-foreground">Happened <span class="font-mono text-[10px]">eventAt</span></dt>
        <dd class="tabular-nums">{evidence.eventAt}</dd>
      {/if}
      {#if evidence.observedAt}
        <dt class="text-muted-foreground">Observed <span class="font-mono text-[10px]">observedAt</span></dt>
        <dd class="tabular-nums">{evidence.observedAt}</dd>
      {/if}
      {#if evidence.score !== undefined}
        <dt class="text-muted-foreground">Score</dt>
        <dd>
          <span class="tabular-nums">{evidence.score}</span>
          <span class="text-muted-foreground text-xs">- {result.adapter}'s own scale; not comparable with other adapters</span>
        </dd>
      {/if}
      {#if usedIn.length > 0}
        <dt class="text-muted-foreground">Used in</dt>
        <dd class="text-xs">{usedIn.map(({ block }) => block.title ?? block.kind).join(', ')}</dd>
      {/if}
    </dl>
  </section>

  <Separator />

  <section class="flex flex-col gap-2">
    <h3 class="section-title">How {result.adapter} read the question</h3>
    {#if interpretation.description}<p class="text-sm">{interpretation.description}</p>{/if}
    {#if interpretation.assumptions.length > 0}
      <ul class="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-xs">
        {#each interpretation.assumptions as assumption, index (index)}<li>{assumption}</li>{/each}
      </ul>
    {/if}
    {#if interpretation.timeRange}
      <p class="text-muted-foreground text-xs">From <span class="tabular-nums">{interpretation.timeRange.from}</span> to <span class="tabular-nums">{interpretation.timeRange.to}</span></p>
    {/if}
    {#if interpretation.nativeQuery}
      <pre class="bg-muted overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap">{interpretation.nativeQuery}</pre>
    {/if}
    <p class="text-muted-foreground text-xs">
      Coverage: {coverage.mode === 'exhaustive' ? 'every matching record' : coverage.mode === 'top-k' ? 'top matches only' : 'unknown'}{coverage.truncated
        ? ', truncated'
        : ''} in scope <code class="font-mono">{coverage.scope}</code>{#if coverage.checkpoint}, at checkpoint <code class="font-mono">{coverage.checkpoint}</code>{/if}.
    </p>
  </section>
</div>
