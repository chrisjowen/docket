<script lang="ts">
  import type { AnsweredResult, ShownBlock } from '$lib/ask/outcome.js'
  import type { BoardScope } from '$lib/workspace.svelte.js'
  import EntitiesBlock from './blocks/entities-block.svelte'
  import EvidenceBlock from './blocks/evidence-block.svelte'
  import GraphBlock from './blocks/graph-block.svelte'
  import MetricBlock from './blocks/metric-block.svelte'
  import TableBlock from './blocks/table-block.svelte'
  import TimelineBlock from './blocks/timeline-block.svelte'
  import UnknownBlock from './blocks/unknown-block.svelte'

  interface Props {
    shown: ShownBlock
    result: AnsweredResult
    onboard: (scope: BoardScope) => void
  }

  let { shown, result, onboard }: Props = $props()

  const KIND_LABEL: Record<string, string> = {
    entities: 'Exhibits',
    passages: 'Passages',
    facts: 'Facts',
    graph: 'Graph',
    metric: 'Metric',
    table: 'Table',
    timeline: 'Timeline'
  }
</script>

<section class="flex flex-col gap-2" aria-label={shown.block.title ?? KIND_LABEL[shown.block.kind] ?? shown.block.kind}>
  <h4 class="flex items-baseline gap-2 text-sm">
    <span class="font-medium">{shown.block.title ?? KIND_LABEL[shown.block.kind] ?? shown.block.kind}</span>
    <span class="text-muted-foreground text-[10px] tracking-wide uppercase">{KIND_LABEL[shown.block.kind] ?? shown.block.kind}</span>
  </h4>
  {#if !shown.known}
    <UnknownBlock block={shown.block} {result} />
  {:else if shown.block.kind === 'entities'}
    <EntitiesBlock block={shown.block} {result} onboard={(ids, label) => onboard({ label, ids, links: [] })} />
  {:else if shown.block.kind === 'passages' || shown.block.kind === 'facts'}
    <EvidenceBlock block={shown.block} {result} />
  {:else if shown.block.kind === 'graph'}
    <GraphBlock block={shown.block} {result} {onboard} />
  {:else if shown.block.kind === 'metric'}
    <MetricBlock block={shown.block} {result} />
  {:else if shown.block.kind === 'table'}
    <TableBlock block={shown.block} {result} />
  {:else if shown.block.kind === 'timeline'}
    <TimelineBlock block={shown.block} {result} />
  {/if}
</section>
