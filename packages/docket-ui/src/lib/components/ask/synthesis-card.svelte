<script lang="ts">
  import Archive from '@lucide/svelte/icons/archive'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import type { AskOutcome } from '$lib/ask/outcome.js'
  import { citationsAsMentions } from '$lib/model.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import Notes from '../notes.svelte'
  import { evidenceLabel } from './view.js'

  /** The model's summary, when there is one - the results below stand without it. */
  let { outcome }: { outcome: AskOutcome } = $props()

  const workspace = getWorkspace()
  const byId = $derived(new Map(workspace.graph?.entities.map((entity) => [entity.id, entity]) ?? []))
  const synthesis = $derived(outcome.synthesis)
  const cited = $derived(
    (synthesis?.citedEvidence ?? []).flatMap((id) => {
      const item = workspace.ask.evidence.get(id)
      const result = outcome.results.find((candidate) => candidate.adapter === item?.adapter)
      return item && result?.state === 'answered' ? [{ id, item, label: `${item.adapter} ${evidenceLabel(result, id)}` }] : []
    })
  )

  const when = (iso: string): string => {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }
</script>

{#if synthesis}
  <section class="bg-card flex flex-col gap-2 rounded-lg border p-4" aria-label="Summary">
    <h3 class="section-title">Summary</h3>
    <Notes
      content={citationsAsMentions(synthesis.text, new Set(synthesis.citedEntities))}
      titleOf={(id) => byId.get(id)?.title}
      onselect={(id) => workspace.select(id)}
    />
    {#if cited.length > 0}
      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-muted-foreground">Rests on</span>
        {#each cited as { id, item, label } (id)}
          <button
            type="button"
            class="hover:bg-muted rounded border px-1.5 font-mono text-[11px] {item.evidence.kind === 'derived-fact' ? 'border-dashed border-amber-600/60' : ''}"
            title={item.evidence.text}
            onclick={() => workspace.inspectEvidence(id)}
          >
            {label}
          </button>
        {/each}
      </div>
    {/if}
    <p class="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
      Written by <code class="font-mono">{synthesis.model}</code> from the results below, which remain the record.
      {#if synthesis.cached}
        <Badge variant="outline" class="gap-1 text-[10px]" title={synthesis.createdAt ? `Written ${when(synthesis.createdAt)}` : undefined}>
          <Archive class="size-3" /> from the cache
        </Badge>
      {/if}
    </p>
  </section>
{:else if outcome.notice && outcome.notice.reason !== 'disabled'}
  <div
    class="flex gap-2 rounded-md border p-3 text-xs {outcome.notice.reason === 'failed' ? 'border-destructive/40' : 'border-amber-500/40 bg-amber-500/10'}"
  >
    <CircleAlert class="mt-0.5 size-4 shrink-0 {outcome.notice.reason === 'failed' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}" />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="font-medium">No summary - the results below are complete without one.</span>
      <Notes content={outcome.notice.message} titleOf={(id) => byId.get(id)?.title} onselect={(id) => workspace.select(id)} />
    </div>
  </div>
{/if}
