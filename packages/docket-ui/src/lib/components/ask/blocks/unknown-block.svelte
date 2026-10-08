<script lang="ts">
  import Braces from '@lucide/svelte/icons/braces'
  import type { AnsweredResult, UnknownBlock } from '$lib/ask/outcome.js'
  import EvidenceChips from '../evidence-chips.svelte'

  /** A block kind this version cannot draw: shown as data, never run. */
  let { block, result }: { block: UnknownBlock; result: AnsweredResult } = $props()

  const fields = $derived(Object.entries(block.raw).filter(([key]) => !['id', 'kind', 'title', 'evidenceIds'].includes(key)))
</script>

<div class="flex flex-col gap-2 rounded-md border border-dashed p-3 text-sm">
  <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
    <Braces class="size-3.5" aria-hidden="true" />
    A <code class="font-mono">{block.kind}</code> block, which this version of docket has no view for. Its data, as sent:
  </p>
  {#if fields.length > 0}
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {#each fields as [key, value] (key)}
        <dt class="text-muted-foreground font-mono">{key}</dt>
        <dd class="min-w-0">
          <pre class="bg-muted max-h-48 overflow-auto rounded px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
        </dd>
      {/each}
    </dl>
  {/if}
  <EvidenceChips ids={block.evidenceIds} {result} />
</div>
