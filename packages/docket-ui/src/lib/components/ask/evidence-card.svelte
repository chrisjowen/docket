<script lang="ts">
  import type { RetrievedEvidence } from '@docket/contracts'
  import { referenceLocation, standingOf } from '$lib/ask/evidence.js'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import StandingBadge from './standing-badge.svelte'
  import { getAskView } from './view.js'

  /** One passage or fact as a card: its text, where it is on record, and whether it is. */
  let { evidence, result }: { evidence: RetrievedEvidence; result: AnsweredResult } = $props()

  const workspace = getWorkspace()
  const view = getAskView()
  const standing = $derived(standingOf(evidence, view.casebook, result.references?.[evidence.id]))
  const byEngine = $derived(standing === 'derived' || standing === 'derived-unresolved')
  const active = $derived(workspace.inspector?.kind === 'evidence' && workspace.inspector.evidenceId === evidence.id)
  const where = $derived(evidence.canonicalRefs[0])
</script>

<button
  type="button"
  class="bg-card hover:border-ring/60 flex w-full flex-col gap-1.5 rounded-md border p-3 text-left text-sm transition-colors {standing ===
  'derived-unresolved'
    ? 'border-dashed border-amber-600/50'
    : ''} {active ? 'ring-ring/50 ring-2' : ''}"
  onclick={() => workspace.inspectEvidence(evidence.id)}
>
  <span class="flex flex-wrap items-center gap-1.5">
    <span class="text-muted-foreground font-mono text-[10px]">{view.label(result, evidence.id)}</span>
    <StandingBadge {standing} />
    {#if evidence.derivation}
      <span class="text-muted-foreground text-[10px]">
        by {evidence.derivation.engine}{evidence.derivation.model ? ` · ${evidence.derivation.model}` : ''}
      </span>
    {/if}
    {#if evidence.score !== undefined}
      <span class="text-muted-foreground ml-auto text-[10px] tabular-nums" title="The adapter's own score: comparable only within {result.adapter}">
        score {evidence.score}
      </span>
    {/if}
  </span>
  {#if byEngine}
    <span class="break-words">{evidence.text}</span>
  {:else}
    <blockquote class="border-gilt/60 border-l-2 pl-2.5 font-serif break-words">{evidence.text}</blockquote>
  {/if}
  {#if where}
    <span class="text-muted-foreground truncate font-mono text-[11px]" title={referenceLocation(where)}>
      {referenceLocation(where)}{evidence.canonicalRefs.length > 1 ? ` +${evidence.canonicalRefs.length - 1} more` : ''}
    </span>
  {:else}
    <span class="text-muted-foreground text-[11px] italic">No canonical reference</span>
  {/if}
</button>
