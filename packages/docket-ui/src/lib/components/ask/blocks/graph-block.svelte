<script lang="ts">
  import type { GraphBlock } from '@docket/contracts'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Eye from '@lucide/svelte/icons/eye'
  import { Button } from '$lib/components/ui/button/index.js'
  import { resolves } from '$lib/ask/evidence.js'
  import type { AnsweredResult } from '$lib/ask/outcome.js'
  import { edgeKey } from '$lib/model.js'
  import { getTypeStyle } from '$lib/type-style.js'
  import type { BoardScope } from '$lib/workspace.svelte.js'
  import { getWorkspace } from '$lib/workspace.svelte.js'
  import GraphView, { type GraphLink, type GraphNode } from '../../graph-view.svelte'
  import EvidenceChips from '../evidence-chips.svelte'
  import { getAskView } from '../view.js'

  /**
   * The subgraph an adapter returned, drawn as returned: its nodes, its edges
   * and the paths it used, highlighted - never relationships guessed between
   * them from the casebook.
   */
  let { block, result, onboard }: { block: GraphBlock; result: AnsweredResult; onboard: (scope: BoardScope) => void } = $props()

  const workspace = getWorkspace()
  const style = getTypeStyle()
  const view = getAskView()
  const byId = $derived(new Map(workspace.graph?.entities.map((entity) => [entity.id, entity]) ?? []))

  /** A node's id on the board: its canonical entity's, when it names one that resolves. */
  const canonicalOf = $derived(
    new Map(
      block.nodes.flatMap((node) =>
        node.ref && node.ref.kind === 'entity' && resolves(node.ref, view.casebook) ? [[node.id, node.ref.id] as const] : []
      )
    )
  )
  const boardId = (id: string): string => canonicalOf.get(id) ?? `${block.id}\u0000${id}`
  const labelOf = $derived(new Map(block.nodes.map((node) => [node.id, node.label])))

  const nodes: GraphNode[] = $derived(
    block.nodes.map((node) => {
      const entity = byId.get(canonicalOf.get(node.id) ?? '')
      return entity
        ? { id: entity.id, title: node.label || entity.title, type: entity.type, ghost: false }
        : { id: boardId(node.id), title: node.label, type: node.type ?? '', ghost: true }
    })
  )
  const links: GraphLink[] = $derived(
    block.edges.map((edge) => {
      const [source, target] = [boardId(edge.source), boardId(edge.target)]
      return { key: edgeKey({ source, rel: edge.rel, target }), source, target, rel: edge.rel }
    })
  )

  /** Paths the answer used stay at full strength; the rest of the subgraph fades. */
  const emphasis = $derived.by(() => {
    if (!block.paths || block.paths.length === 0) return null
    const onPath = new Set<string>()
    const steps = new Set<string>()
    for (const path of block.paths) {
      path.forEach((id, index) => {
        onPath.add(boardId(id))
        const next = path[index + 1]
        if (next !== undefined) steps.add(`${id}\u0000${next}`)
      })
    }
    const keys = new Set(
      block.edges
        .filter((edge) => steps.has(`${edge.source}\u0000${edge.target}`) || steps.has(`${edge.target}\u0000${edge.source}`))
        .map((edge) => edgeKey({ source: boardId(edge.source), rel: edge.rel, target: boardId(edge.target) }))
    )
    return { nodes: onPath, links: keys }
  })

  const scope = $derived<BoardScope>({
    label: `${result.adapter}'s ${block.title ?? 'subgraph'}`,
    ids: [...canonicalOf.values()],
    links: block.edges.flatMap((edge) => {
      const [source, target] = [canonicalOf.get(edge.source), canonicalOf.get(edge.target)]
      return source && target ? [{ source, rel: edge.rel, target }] : []
    })
  })
</script>

<div class="h-72 overflow-hidden rounded-md border">
  <GraphView
    {nodes}
    {links}
    colourOf={style.colour}
    iconOf={style.icon}
    selected={workspace.selected}
    {emphasis}
    focus={null}
    emptyHint="The adapter returned an empty graph."
    onselect={(id) => {
      if (id && byId.has(id)) workspace.select(id)
    }}
  />
</div>

{#if block.paths && block.paths.length > 0}
  <ol class="flex flex-col gap-1">
    {#each block.paths as path, index (index)}
      <li class="flex flex-wrap items-center gap-1 text-xs">
        <span class="text-muted-foreground">Path {index + 1}:</span>
        {#each path as id, step (step)}
          {#if step > 0}<ArrowRight class="text-muted-foreground size-3" />{/if}
          <span class="bg-muted rounded px-1.5 py-0.5">{labelOf.get(id) ?? id}</span>
        {/each}
      </li>
    {/each}
  </ol>
{/if}

<details class="text-xs">
  <summary class="text-muted-foreground cursor-pointer">{block.edges.length} {block.edges.length === 1 ? 'edge' : 'edges'} returned</summary>
  <ul class="mt-1 flex flex-col gap-1">
    {#each block.edges as edge, index (index)}
      <li class="flex flex-wrap items-center gap-1.5">
        <span>{labelOf.get(edge.source) ?? edge.source}</span>
        <span class="text-muted-foreground font-mono">{edge.rel}</span>
        <ArrowRight class="text-muted-foreground size-3" />
        <span>{labelOf.get(edge.target) ?? edge.target}</span>
        <EvidenceChips ids={edge.evidenceIds ?? []} {result} />
      </li>
    {/each}
  </ul>
</details>

<div class="flex flex-wrap items-center gap-2">
  <EvidenceChips ids={block.evidenceIds} {result} />
  {#if scope.ids.length > 0}
    <Button variant="ghost" size="xs" class="ml-auto" onclick={() => onboard(scope)}><Eye /> Show on the board</Button>
  {/if}
</div>
