<script lang="ts">
  import type { MetricBlock } from '@docket/contracts'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import EvidenceChips from '../evidence-chips.svelte'

  let { block, result }: { block: MetricBlock; result: AnsweredResult } = $props()

  const coverage = $derived(result.answer.coverage)
</script>

<div class="bg-card flex flex-wrap items-end gap-x-6 gap-y-2 rounded-md border px-4 py-3">
  <div class="flex flex-col">
    <span class="text-muted-foreground text-xs">{block.label}</span>
    <span class="font-serif text-4xl leading-tight font-semibold tabular-nums">
      {block.value.toLocaleString(undefined, { maximumFractionDigits: 20 })}
      {#if block.unit}<span class="text-muted-foreground text-base font-normal">{block.unit}</span>{/if}
    </span>
  </div>
  <div class="flex min-w-0 flex-1 flex-col gap-1 text-xs">
    {#if coverage.mode === 'exhaustive'}
      <span>Every matching record in scope <code class="font-mono">{coverage.scope}</code>{coverage.truncated ? ', but truncated' : ''}.</span>
    {:else if coverage.mode === 'top-k'}
      <span class="text-amber-700 dark:text-amber-400">Counted from a sample of top matches - not an exhaustive count.</span>
    {:else}
      <span class="text-muted-foreground">Coverage unknown: the adapter does not say whether this counts every record.</span>
    {/if}
    <EvidenceChips ids={block.evidenceIds} {result} />
  </div>
</div>
