<script lang="ts">
  import type { EntitiesBlock } from '@docket/contracts'
  import Eye from '@lucide/svelte/icons/eye'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import TypeMark from '../../type-mark.svelte'
  import EvidenceChips from '../evidence-chips.svelte'

  let { block, result, onboard }: { block: EntitiesBlock; result: AnsweredResult; onboard: (ids: string[], label: string) => void } =
    $props()

  const workspace = getWorkspace()
  const byId = $derived(new Map(workspace.graph?.entities.map((entity) => [entity.id, entity]) ?? []))
  const ids = $derived(block.entities.filter((item) => item.ref.kind === 'entity').map((item) => item.ref.id))
</script>

<ol class="flex flex-col divide-y rounded-md border">
  {#each block.entities as item, index (index)}
    {@const entity = item.ref.kind === 'entity' ? byId.get(item.ref.id) : undefined}
    <li>
      <button
        type="button"
        class="hover:bg-muted flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm disabled:cursor-default disabled:hover:bg-transparent {workspace.selected ===
        item.ref.id
          ? 'bg-accent'
          : ''}"
        disabled={!entity}
        onclick={() => entity && workspace.select(entity.id)}
      >
        <TypeMark type={entity?.type ?? null} />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate font-medium">{entity?.title ?? item.ref.id}</span>
          <span class="text-muted-foreground truncate font-mono text-xs">
            {item.ref.id}{item.ref.revision ? ` @ ${item.ref.revision}` : ''}
          </span>
          {#if item.detail}<span class="text-muted-foreground text-xs break-words">{item.detail}</span>{/if}
        </span>
        {#if !entity}
          <Badge variant="outline" class="border-dashed text-[10px]" title="No file in the casebook defines this {item.ref.kind}">unresolved</Badge>
        {/if}
        {#if item.score !== undefined}
          <span class="text-muted-foreground shrink-0 text-xs tabular-nums" title="The adapter's own score: comparable only within {result.adapter}">
            {Number.isInteger(item.score) ? item.score : item.score.toFixed(2)}
          </span>
        {/if}
      </button>
    </li>
  {/each}
</ol>
<div class="flex flex-wrap items-center gap-2">
  <EvidenceChips ids={block.evidenceIds} {result} />
  {#if ids.length > 0}
    <Button variant="ghost" size="xs" class="ml-auto" onclick={() => onboard(ids, `${result.adapter}'s ${block.title ?? 'exhibits'}`)}>
      <Eye /> Show on the board
    </Button>
  {/if}
</div>
