<script lang="ts">
  import type { TimelineBlock, TimelineEvent } from '@docket/contracts'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import EvidenceChips from '../evidence-chips.svelte'

  let { block, result }: { block: TimelineBlock; result: AnsweredResult } = $props()

  /** What a timestamp means, said every time: when it happened is not when it was seen. */
  const SEMANTICS: Record<TimelineEvent['semantics'], string> = {
    event: 'happened',
    observed: 'observed',
    'valid-from': 'valid from',
    'valid-to': 'valid until'
  }

  const events = $derived([...block.events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)))

  const when = (at: string): string => {
    const date = new Date(at)
    if (Number.isNaN(date.getTime())) return at
    return /T\d/.test(at) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : date.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }
</script>

<ol class="flex flex-col border-l pl-4">
  {#each events as event, index (index)}
    <li class="relative flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-sm">
      <span
        class="absolute top-3 -left-[1.3rem] size-2 rounded-full {event.semantics === 'event' ? 'bg-gilt' : 'border-muted-foreground bg-background border'}"
        aria-hidden="true"
      ></span>
      <time datetime={event.at} class="text-muted-foreground w-44 shrink-0 text-xs tabular-nums" title={event.at}>{when(event.at)}</time>
      <span
        class="rounded border px-1 text-[10px] {event.semantics === 'event' ? 'border-gilt/60' : 'border-dashed'}"
        title="What the time means: {SEMANTICS[event.semantics]}"
      >
        {SEMANTICS[event.semantics]}
      </span>
      <span class="min-w-0 flex-1 break-words">{event.label}</span>
      <EvidenceChips ids={event.evidenceIds ?? []} {result} />
    </li>
  {:else}
    <li class="text-muted-foreground text-xs">No events.</li>
  {/each}
</ol>
<EvidenceChips ids={block.evidenceIds} {result} />
