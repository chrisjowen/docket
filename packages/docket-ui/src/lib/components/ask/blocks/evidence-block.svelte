<script lang="ts">
  import type { FactsBlock, PassagesBlock } from '@docket/contracts'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import EvidenceCard from '../evidence-card.svelte'

  /** Passage and fact blocks: the evidence they name, as cards. */
  let { block, result }: { block: PassagesBlock | FactsBlock; result: AnsweredResult } = $props()
</script>

<ul class="grid gap-2 {block.kind === 'facts' ? 'sm:grid-cols-2' : ''}">
  {#each [...new Set(block.evidenceIds)] as id (id)}
    {@const evidence = result.evidence.get(id)}
    {#if evidence}<li class="min-w-0"><EvidenceCard {evidence} {result} /></li>{/if}
  {/each}
</ul>
