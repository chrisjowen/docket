<script lang="ts" module>
  /** What the graph draws for one entity. Ghosts are link targets no file defines yet. */
  export interface GraphNode {
    id: string
    title: string
    type: string
    ghost: boolean
  }

  export interface GraphLink {
    key: string
    source: string
    target: string
    rel: string
  }

  /** Ask the view to bring these entities into frame; a new nonce asks again. */
  export interface FocusRequest {
    ids: string[]
    nonce: number
  }
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import {
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    forceX,
    forceY,
    type Simulation,
    type SimulationLinkDatum,
    type SimulationNodeDatum
  } from 'd3-force'
  import { drag } from 'd3-drag'
  import { select } from 'd3-selection'
  import 'd3-transition'
  import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
  import Minus from '@lucide/svelte/icons/minus'
  import Plus from '@lucide/svelte/icons/plus'
  import Maximize from '@lucide/svelte/icons/maximize'
  import { Button } from '$lib/components/ui/button/index.js'

  interface Node extends SimulationNodeDatum, GraphNode {
    degree: number
  }

  interface Link extends SimulationLinkDatum<Node> {
    key: string
    rel: string
    source: Node
    target: Node
  }

  interface Props {
    nodes: GraphNode[]
    links: GraphLink[]
    colourOf: (type: string) => string
    selected: string | null
    /** Entities and links to keep at full strength; everything else fades. Null: all. */
    emphasis: { nodes: Set<string>; links: Set<string> } | null
    focus: FocusRequest | null
    onselect: (id: string | null) => void
  }

  let { nodes, links, colourOf, selected, emphasis, focus, onselect }: Props = $props()

  let svg = $state<SVGSVGElement>()
  let width = $state(0)
  let height = $state(0)
  let transform = $state<ZoomTransform>(zoomIdentity)
  /** Bumped on every simulation tick; positions are read through it. */
  let tick = $state(0)
  let simNodes = $state.raw<Node[]>([])
  let simLinks = $state.raw<Link[]>([])
  let hovered = $state<Node | null>(null)

  let zoomBehaviour: ZoomBehavior<SVGSVGElement, unknown> | undefined
  const simulation: Simulation<Node, Link> = forceSimulation<Node, Link>()
    .force('charge', forceManyBody<Node>().strength(-320).distanceMax(600))
    .force('collide', forceCollide<Node>((node) => radius(node) + 14))
    .force('x', forceX<Node>(0).strength(0.04))
    .force('y', forceY<Node>(0).strength(0.04))
    .on('tick', () => (tick += 1))
    .stop()

  /**
   * Simulation objects outlive a rebuild, keyed by id: positions survive a
   * filter change, and every link keeps pointing at the node that is drawn.
   */
  const nodePool = new Map<string, Node>()
  const linkPool = new Map<string, Link>()
  let laidOut = false

  const radius = (node: Pick<Node, 'degree' | 'ghost'>): number =>
    node.ghost ? 5 : 6 + Math.min(10, Math.sqrt(node.degree) * 2.2)

  // Only new input rebuilds: the rebuild itself reads and bumps the tick.
  $effect(() => {
    const [input, inputLinks] = [nodes, links]
    untrack(() => rebuild(input, inputLinks))
  })

  function rebuild(input: GraphNode[], inputLinks: GraphLink[]): void {
    const degree = new Map<string, number>()
    for (const link of inputLinks) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
    }

    const fresh: Node[] = []
    const next = input.map((item) => {
      let node = nodePool.get(item.id)
      if (!node) {
        node = { ...item, degree: 0 }
        nodePool.set(item.id, node)
        fresh.push(node)
      }
      Object.assign(node, item, { degree: degree.get(item.id) ?? 0 })
      return node
    })
    const nextLinks: Link[] = inputLinks.flatMap((item) => {
      const source = nodePool.get(item.source)
      const target = nodePool.get(item.target)
      if (!source || !target) return []
      let link = linkPool.get(item.key)
      if (!link) {
        link = { key: item.key, rel: item.rel, source, target }
        linkPool.set(item.key, link)
      }
      link.source = source
      link.target = target
      return [link]
    })

    // New nodes start beside something they link to, not at a random edge.
    for (const node of fresh) {
      const anchor = nextLinks.find((link) => link.source === node && link.target.x !== undefined)?.target
        ?? nextLinks.find((link) => link.target === node && link.source.x !== undefined)?.source
      if (anchor?.x !== undefined && anchor.y !== undefined) {
        node.x = anchor.x + (Math.random() - 0.5) * 40
        node.y = anchor.y + (Math.random() - 0.5) * 40
      }
    }

    simulation.nodes(next)
    simulation.force(
      'link',
      forceLink<Node, Link>(nextLinks)
        .id((node) => node.id)
        .distance((link) => 70 + radius(link.source) + radius(link.target))
        .strength(0.5)
    )
    simNodes = next
    simLinks = nextLinks

    if (!laidOut && next.length > 0) {
      // Settle the first layout before showing it, then frame it.
      simulation.alpha(1)
      for (let i = 0; i < 300 && simulation.alpha() > simulation.alphaMin(); i += 1) simulation.tick()
      laidOut = true
      tick += 1
    } else {
      simulation.alpha(fresh.length > 0 ? 0.5 : 0.15).restart()
    }
  }

  let zoomReady = $state(false)
  onMount(() => {
    zoomBehaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 6])
      .on('zoom', (event: { transform: ZoomTransform }) => (transform = event.transform))
    if (svg) select(svg).call(zoomBehaviour).on('dblclick.zoom', null)
    zoomReady = true
    return () => simulation.stop()
  })

  // Frame the first layout once the view has a size to frame it in.
  let framed = false
  $effect(() => {
    if (framed || !zoomReady || width === 0 || height === 0 || simNodes.length === 0) return
    framed = true
    frame(simNodes, false)
  })

  /** Pan and zoom so `targets` fill the view. */
  function frame(targets: Node[], animate = true): void {
    if (!svg || !zoomBehaviour || width === 0 || targets.length === 0) return
    const xs = targets.map((node) => node.x ?? 0)
    const ys = targets.map((node) => node.y ?? 0)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const padding = 80
    const scale = Math.min(
      targets.length === 1 ? 1.6 : 1.4,
      (width - padding * 2) / Math.max(1, x1 - x0),
      (height - padding * 2) / Math.max(1, y1 - y0)
    )
    const next = zoomIdentity
      .translate(width / 2 - (scale * (x0 + x1)) / 2, height / 2 - (scale * (y0 + y1)) / 2)
      .scale(Math.max(0.08, scale))
    const target = select(svg)
    if (animate) target.transition().duration(450).call(zoomBehaviour.transform, next)
    else target.call(zoomBehaviour.transform, next)
  }

  const zoomBy = (factor: number): void => {
    if (svg && zoomBehaviour) select(svg).transition().duration(200).call(zoomBehaviour.scaleBy, factor)
  }

  let lastNonce = -1
  $effect(() => {
    if (!focus || focus.nonce === lastNonce) return
    lastNonce = focus.nonce
    const wanted = new Set(focus.ids)
    const targets = simNodes.filter((node) => wanted.has(node.id))
    // Let a just-added node take a position before framing it.
    setTimeout(() => frame(targets), targets.some((node) => node.x === undefined) ? 300 : 0)
  })

  function draggable(element: SVGGElement, node: Node) {
    let subject = node
    select(element).call(
      drag<SVGGElement, unknown>()
        .on('start', (event: { active: number }) => {
          if (!event.active) simulation.alphaTarget(0.2).restart()
          subject.fx = subject.x
          subject.fy = subject.y
        })
        .on('drag', (event: { x: number; y: number }) => {
          subject.fx = event.x
          subject.fy = event.y
        })
        .on('end', (event: { active: number }) => {
          if (!event.active) simulation.alphaTarget(0)
          subject.fx = null
          subject.fy = null
        })
    )
    return {
      update(next: Node) {
        subject = next
      }
    }
  }

  /** The visible part of a link: from one circle's edge to the other's, leaving room for the arrow. */
  const segment = (link: Link, _tick: number) => {
    const { source, target } = link
    const dx = (target.x ?? 0) - (source.x ?? 0)
    const dy = (target.y ?? 0) - (source.y ?? 0)
    const length = Math.hypot(dx, dy) || 1
    const from = radius(source) + 1
    const to = radius(target) + 3
    return {
      x1: (source.x ?? 0) + (dx * from) / length,
      y1: (source.y ?? 0) + (dy * from) / length,
      x2: (target.x ?? 0) - (dx * to) / length,
      y2: (target.y ?? 0) - (dy * to) / length,
      mx: (source.x ?? 0) + dx / 2,
      my: (source.y ?? 0) + dy / 2,
      angle: ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 180 - 90
    }
  }

  const at = (node: Node, _tick: number): string => `translate(${node.x ?? 0},${node.y ?? 0})`

  /** The most connected entities stay labelled at any zoom, so the graph has landmarks. */
  const landmarks = $derived(
    new Set([...simNodes].sort((a, b) => b.degree - a.degree).slice(0, 12).filter((n) => n.degree > 1).map((n) => n.id))
  )

  const faded = (id: string): boolean => emphasis !== null && !emphasis.nodes.has(id)
  const linkFaded = (link: Link): boolean => emphasis !== null && !emphasis.links.has(link.key)

  const labelled = (node: Node): boolean =>
    transform.k >= 1.2 ||
    node.id === selected ||
    hovered?.id === node.id ||
    (emphasis !== null ? emphasis.nodes.has(node.id) && (emphasis.nodes.size <= 30 || transform.k >= 0.7) : landmarks.has(node.id))

  const linkLabelled = (link: Link): boolean =>
    hovered !== null
      ? link.source === hovered || link.target === hovered
      : emphasis !== null && emphasis.links.has(link.key) && emphasis.links.size <= 40

  const truncate = (text: string): string => (text.length > 28 ? `${text.slice(0, 27)}…` : text)

  const tooltip = $derived.by(() => {
    void tick
    if (!hovered) return null
    return {
      node: hovered,
      left: transform.applyX(hovered.x ?? 0),
      top: transform.applyY(hovered.y ?? 0) - radius(hovered) * transform.k
    }
  })
</script>

<div class="relative h-full w-full overflow-hidden" bind:clientWidth={width} bind:clientHeight={height}>
  <svg
    bind:this={svg}
    {width}
    {height}
    class="bg-graph-surface block cursor-grab select-none active:cursor-grabbing"
    role="img"
    aria-label="Graph of entities and their relationships"
  >
    <defs>
      <marker id="arrow" viewBox="0 -4 8 8" refX="8" refY="0" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0,-4L8,0L0,4" style="fill: var(--graph-edge)" />
      </marker>
      <marker id="arrow-strong" viewBox="0 -4 8 8" refX="8" refY="0" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0,-4L8,0L0,4" style="fill: var(--graph-label)" />
      </marker>
    </defs>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <rect {width} {height} fill="transparent" onclick={() => onselect(null)} />
    <g transform={transform.toString()}>
      {#each simLinks as link (link.key)}
        {@const line = segment(link, tick)}
        {@const strong = emphasis !== null && !linkFaded(link)}
        <line
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke-width={strong ? 1.75 : 1}
          vector-effect="non-scaling-stroke"
          stroke-dasharray={link.target.ghost ? '4 3' : undefined}
          marker-end={strong ? 'url(#arrow-strong)' : 'url(#arrow)'}
          style="stroke: {strong ? 'var(--graph-label)' : 'var(--graph-edge)'}"
          opacity={linkFaded(link) ? 0.12 : 1}
        />
        {#if linkLabelled(link)}
          <text
            x={line.mx}
            y={line.my}
            dy={-3 / transform.k}
            transform="rotate({line.angle} {line.mx} {line.my})"
            text-anchor="middle"
            class="pointer-events-none"
            style="font-size: {10 / transform.k}px; fill: var(--graph-label); paint-order: stroke; stroke: var(--graph-surface); stroke-width: {3 / transform.k}px"
          >
            {link.rel}
          </text>
        {/if}
      {/each}

      {#each simNodes as node (node.id)}
        {@const r = radius(node)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <g
          transform={at(node, tick)}
          class="cursor-pointer"
          opacity={faded(node.id) ? 0.15 : 1}
          role="button"
          tabindex="-1"
          aria-label={node.title}
          use:draggable={node}
          onclick={(event) => {
            event.stopPropagation()
            onselect(node.id)
          }}
          onpointerenter={() => (hovered = node)}
          onpointerleave={() => (hovered = null)}
        >
          {#if node.id === selected}
            <circle r={r + 4 / transform.k} fill="none" stroke-width="2" vector-effect="non-scaling-stroke" style="stroke: var(--foreground)" />
          {/if}
          {#if node.ghost}
            <circle {r} stroke-width="1.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" style="fill: var(--graph-surface); stroke: var(--graph-other)" />
          {:else}
            <circle {r} stroke-width="2" vector-effect="non-scaling-stroke" style="fill: {colourOf(node.type)}; stroke: var(--graph-surface)" />
          {/if}
          <!-- A hit target bigger than the mark. -->
          <circle r={r + 6} fill="transparent" />
          {#if labelled(node)}
            <text
              y={r + 13 / transform.k}
              text-anchor="middle"
              class="pointer-events-none {node.id === selected ? 'font-semibold' : ''}"
              style="font-size: {11 / transform.k}px; fill: {node.ghost ? 'var(--graph-other)' : 'var(--foreground)'}; paint-order: stroke; stroke: var(--graph-surface); stroke-width: {3 / transform.k}px; stroke-linejoin: round"
            >
              {truncate(node.ghost ? node.id : node.title)}
            </text>
          {/if}
        </g>
      {/each}
    </g>
  </svg>

  {#if tooltip}
    <div
      class="bg-popover text-popover-foreground pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs shadow-md"
      style="left: {tooltip.left}px; top: {tooltip.top - 8}px"
    >
      <div class="font-medium">{tooltip.node.ghost ? tooltip.node.id : tooltip.node.title}</div>
      <div class="text-muted-foreground font-mono text-[11px]">
        {tooltip.node.ghost ? 'not defined by any file yet' : tooltip.node.id}
      </div>
      <div class="text-muted-foreground mt-0.5">
        {tooltip.node.ghost ? 'unresolved link target' : tooltip.node.type} · {tooltip.node.degree}
        {tooltip.node.degree === 1 ? 'link' : 'links'}
      </div>
    </div>
  {/if}

  <div class="absolute right-3 bottom-3 flex flex-col gap-1">
    <Button variant="outline" size="icon-sm" aria-label="Zoom in" onclick={() => zoomBy(1.4)}><Plus /></Button>
    <Button variant="outline" size="icon-sm" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.4)}><Minus /></Button>
    <Button variant="outline" size="icon-sm" aria-label="Fit the graph to the view" onclick={() => frame(simNodes)}>
      <Maximize />
    </Button>
  </div>

  {#if nodes.length === 0}
    <div class="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
      Nothing to show with these filters.
    </div>
  {/if}
</div>
