<script lang="ts">
  import { standingOf } from '$lib/ask/evidence.js'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import { getAskView } from './view.js'

  /** Links to the evidence behind a block, row, edge or event; each opens the inspector. */
  let { ids, result }: { ids: readonly string[]; result: AnsweredResult } = $props()

  const workspace = getWorkspace()
  const view = getAskView()
</script>

{#if ids.length > 0}
  <span class="inline-flex flex-wrap items-center gap-1">
    {#each ids as id (id)}
      {@const evidence = result.evidence.get(id)}
      {#if evidence}
        {@const standing = standingOf(evidence, view.casebook)}
        <button
          type="button"
          class="hover:bg-muted rounded border px-1 font-mono text-[10px] leading-4 {standing === 'canonical'
            ? 'border-emerald-600/40'
            : standing === 'derived'
              ? 'border-sky-600/40'
              : 'border-dashed border-amber-600/60'} {workspace.inspector?.kind === 'evidence' && workspace.inspector.evidenceId === id
            ? 'bg-accent'
            : ''}"
          title={`${evidence.kind}: ${evidence.text}`}
          aria-label={`Inspect evidence ${view.label(result, id)}: ${evidence.text}`}
          onclick={() => workspace.inspectEvidence(id)}
        >
          {view.label(result, id)}
        </button>
      {/if}
    {/each}
  </span>
{/if}
