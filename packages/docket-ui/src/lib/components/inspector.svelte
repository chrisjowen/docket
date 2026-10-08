<script lang="ts">
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import type { UiGraph } from '$lib/types.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import EvidenceInspector from './ask/evidence-inspector.svelte'
  import EntityPanel from './entity-panel.svelte'

  /** The one inspector every route opens things in: an exhibit, or a piece of an answer's evidence. */
  let { graph }: { graph: UiGraph } = $props()

  const workspace = getWorkspace()
  const target = $derived(workspace.inspector)
  const entity = $derived(target?.kind === 'exhibit' ? graph.entities.find((item) => item.id === target.id) : undefined)
  const found = $derived(target?.kind === 'evidence' ? workspace.ask.evidence.get(target.evidenceId) : undefined)
  const result = $derived(
    found ? workspace.ask.outcome?.results.find((item) => item.adapter === found.adapter && item.state === 'answered') : undefined
  )
</script>

<ScrollArea class="h-full">
  {#if target?.kind === 'exhibit' && entity}
    <EntityPanel {graph} {entity} onselect={(id) => workspace.select(id, { focus: true })} />
  {:else if target?.kind === 'exhibit'}
    <div class="flex flex-col gap-2 p-4">
      <code class="bg-muted self-start rounded px-1.5 py-0.5 font-mono text-xs">{target.id}</code>
      <p class="text-muted-foreground text-sm">
        An exhibit cites this, but no file in <code class="font-mono">.docket/</code> defines it yet.
      </p>
    </div>
  {:else if target?.kind === 'evidence' && found && result?.state === 'answered'}
    <EvidenceInspector {graph} evidence={found.evidence} {result} />
  {:else if target?.kind === 'evidence'}
    <div class="text-muted-foreground p-4 text-sm">That evidence belonged to an earlier answer. Ask again to inspect it.</div>
  {:else}
    <div class="text-muted-foreground flex flex-col gap-2 p-5 text-sm">
      <p class="text-foreground font-serif text-lg">Nothing selected</p>
      <p>Pick an exhibit on the board or in the table, or a piece of evidence in an answer, to read it here.</p>
      <p class="text-xs">
        Try <code class="font-mono">type:service</code>, <code class="font-mono">rel:depends_on</code> or
        <code class="font-mono">tag:core</code> in Find to narrow it down.
      </p>
    </div>
  {/if}
</ScrollArea>
