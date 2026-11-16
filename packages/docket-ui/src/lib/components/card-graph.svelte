<script lang="ts" module>
  /** One exhibit as its case card shows it. Ghosts are link targets no file defines yet: their title is what to call them. */
  export interface CardNode {
    id: string
    title: string
    type: string
    ghost: boolean
    /** The type's short code: SVC, API ... */
    code: string
    colour: string
    /** Its confidence, 0 to 1, when assessed. */
    weight: number | null
    /** What follows the weight on the card's foot: `3 obs.`, `match`. */
    note: string | null
    /** Weakly supported: its outline dashes red. */
    weak: boolean
  }

  export interface CardLink {
    key: string
    source: string
    target: string
    rel: string
    /** Weakly supported: its connector dashes. */
    weak: boolean
  }

  /** Ask the board to bring these exhibits into frame; a new nonce asks again. */
  export interface FocusRequest {
    ids: string[]
    nonce: number
  }
</script>

<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte'
  import { select } from 'd3-selection'
  import 'd3-transition'
  import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
  import Maximize from '@lucide/svelte/icons/maximize'
  import Minus from '@lucide/svelte/icons/minus'
  import Plus from '@lucide/svelte/icons/plus'
  import Search from '@lucide/svelte/icons/search'
  import { CARD, boxOf, connector, layoutCards, type Box, type Point } from '$lib/cards.js'
  import { matches, neighbourhood } from '$lib/model.js'

  /**
   * The evidence board as Docket Cloud draws it: case cards on a dotted
   * canvas, joined by curved connectors. Picking a card zooms to fit it and
   * everything one link away; the rest shrink and fade behind a paper
   * spotlight, and its connectors draw in red.
   */
  interface Props {
    nodes: CardNode[]
    links: CardLink[]
    /** Every card's centre. Omitted: laid out from `nodes` and `links`. */
    placed?: ReadonlyMap<string, Point> | null
    selected: string | null
    /** Exhibits and links to keep at full strength; everything else recedes. Omitted: the selection and its neighbours. */
    emphasis?: { nodes: Set<string>; links: Set<string> } | null
    focus?: FocusRequest | null
    onselect: (id: string | null) => void
    /** More controls beside the search, in the canvas's top row. */
    toolbar?: Snippet
    emptyHint?: string
    /** Show the find box in the canvas's top row. */
    find?: boolean
    /** Show the hint on how to move about. */
    hint?: boolean
  }

  let {
    nodes,
    links,
    placed: given = null,
    selected,
    emphasis = null,
    focus = null,
    onselect,
    toolbar,
    emptyHint = 'Switch exhibit types on above, or find one with search.',
    find = true,
    hint = true
  }: Props = $props()

  const placed = $derived(given ?? layoutCards(nodes, links))

  let svg = $state<SVGSVGElement>()
  let width = $state(0)
  let height = $state(0)
  let transform = $state<ZoomTransform>(zoomIdentity)
  let query = $state('')
  let labels = $state(false)
  let spot = $state<{ x: number; y: number; r: number } | null>(null)
  let behaviour: ZoomBehavior<SVGSVGElement, unknown> | undefined

  const shown = $derived(new Set(nodes.map((node) => node.id)))
  const drawn = $derived(nodes.filter((node) => placed.has(node.id)))
  const routes = $derived(
    links.flatMap((link) => {
      const a = placed.get(link.source)
      const b = placed.get(link.target)
      return a && b && link.source !== link.target ? [{ ...link, ...connector(a, b) }] : []
    })
  )
  const active = $derived(selected !== null && shown.has(selected) ? selected : null)
  const found = $derived(
    query.trim() ? new Set(nodes.filter((node) => matches([node.title, node.id, node.type, node.code], query)).map((node) => node.id)) : null
  )
  /** Cards kept at full strength: what the board was asked to stress, else the selection and its neighbours, else what the search finds. */
  const near = $derived(emphasis?.nodes ?? (active ? neighbourhood(links, active) : found))
  const nearLink = (link: CardLink): boolean =>
    emphasis ? emphasis.links.has(link.key) : active !== null && (link.source === active || link.target === active)
  /** The connectors drawn in red: the selection's own. */
  const inked = (link: CardLink): boolean => active !== null && nearLink(link)

  const fit = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text)
  const percent = (weight: number | null): string => (weight === null ? '—' : `${Math.round(weight * 100)}%`)
  const describe = (node: CardNode): string =>
    node.ghost
      ? `${node.id}, not in the casebook yet`
      : `${node.title}, ${node.type} ${node.id}, confidence ${percent(node.weight)}${node.note ? `, ${node.note}` : ''}`

  const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** Move the view, eased, unless motion is reduced. */
  function moveTo(next: ZoomTransform, duration: number, done?: () => void): void {
    if (!svg || !behaviour) return
    const target = select(svg)
    if (reducedMotion() || duration === 0) {
      target.interrupt().call(behaviour.transform, next)
      done?.()
      return
    }
    target
      .interrupt()
      .transition()
      .duration(duration)
      .call(behaviour.transform, next)
      .on('end', () => done?.())
  }

  /** The transform that puts `box` (canvas units) in the middle of `region` (pixels inside the canvas). */
  const framing = (box: Box, region: Box, most: number): ZoomTransform => {
    const k = Math.max(0.08, Math.min(most, region.w / Math.max(1, box.w), region.h / Math.max(1, box.h)))
    return zoomIdentity.translate(region.x + region.w / 2 - k * (box.x + box.w / 2), region.y + region.h / 2 - k * (box.y + box.h / 2)).scale(k)
  }

  /** The canvas below its own top row. */
  const freeRegion = (): Box => ({ x: 16, y: 56, w: Math.max(1, width - 32), h: Math.max(1, height - 90) })

  /** The whole board in view. */
  function home(animate = true): void {
    spot = null
    const box = boxOf(shown, placed)
    if (!box || width === 0) return
    let padded = { x: box.x - 50, y: box.y - 70, w: box.w + 100, h: box.h + 120 }
    // On a phone, start closer in: half the board across, centred.
    if (width < 600 && drawn.length > 6) padded = { ...padded, x: padded.x + padded.w / 4, w: padded.w / 2 }
    moveTo(framing(padded, { x: 10, y: 50, w: width - 20, h: height - 60 }, 1.2), animate ? 600 : 0)
  }

  /** Frame the exhibit and its neighbours, then light it. */
  function focusOn(id: string): void {
    const ids = [...neighbourhood(links, id)].filter((each) => shown.has(each))
    const box = boxOf(ids, placed)
    const at = placed.get(id)
    if (!box || !at) return
    spot = null
    const next = framing({ x: box.x - 60, y: box.y - 60, w: box.w + 120, h: box.h + 120 }, freeRegion(), 1.6)
    moveTo(next, 760, () => {
      const reach = Math.max(
        ...ids.map((each) => {
          const other = placed.get(each)
          return other ? Math.hypot(other.x - at.x, other.y - at.y) : 0
        })
      )
      spot = { x: next.applyX(at.x), y: next.applyY(at.y), r: Math.max(150, reach * next.k + 140 * next.k) }
    })
  }

  /** Frame some exhibits, without lighting any. */
  function frameAll(ids: string[]): void {
    const box = boxOf(ids, placed)
    if (!box) return
    spot = null
    moveTo(framing({ x: box.x - 60, y: box.y - 60, w: box.w + 120, h: box.h + 120 }, freeRegion(), 1.4), 600)
  }

  onMount(() => {
    if (!svg) return
    behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 3])
      .on('zoom', (event: { transform: ZoomTransform; sourceEvent: Event | null }) => {
        transform = event.transform
        // A hand on the canvas puts the spotlight away.
        if (event.sourceEvent) spot = null
      })
    select(svg).call(behaviour).on('dblclick.zoom', null)
    return () => {
      if (svg) select(svg).interrupt().on('.zoom', null)
    }
  })

  // The first frame, once the canvas has a size: the board, or straight to the selection.
  let framed = false
  let last: string | null = null
  $effect(() => {
    if (framed || width === 0 || height === 0 || !behaviour || drawn.length === 0) return
    framed = true
    untrack(() => {
      home(false)
      if (active) requestAnimationFrame(() => requestAnimationFrame(() => active && focusOn(active)))
      last = active
    })
  })

  // A new selection is framed; clearing it goes back to the whole board.
  $effect(() => {
    const now = active
    if (!framed || now === last) return
    last = now
    untrack(() => {
      if (now) requestAnimationFrame(() => focusOn(now))
      else home()
    })
  })

  // Asked to frame some exhibits: the selection's own framing wins when it is one of them.
  let lastNonce = -1
  $effect(() => {
    if (!focus || focus.nonce === lastNonce) return
    lastNonce = focus.nonce
    const ids = focus.ids.filter((id) => shown.has(id))
    untrack(() => {
      if (!framed || ids.length === 0) return
      if (ids.length === 1 && ids[0] === active) requestAnimationFrame(() => focusOn(ids[0] as string))
      else requestAnimationFrame(() => frameAll(ids))
    })
  })

  const zoomBy = (factor: number): void => {
    if (!svg || !behaviour) return
    spot = null
    const target = select(svg).interrupt()
    if (reducedMotion()) target.call(behaviour.scaleBy, factor)
    else target.transition().duration(380).call(behaviour.scaleBy, factor)
  }

  const pick = (event: Event, id: string): void => {
    event.stopPropagation()
    onselect(id)
  }
</script>

<div class="canvas" class:has-labels={labels} bind:clientWidth={width} bind:clientHeight={height} data-testid="board" data-nodes={drawn.length} data-links={routes.length}>
  <svg
    bind:this={svg}
    {width}
    {height}
    class="net"
    class:dim={near !== null}
    role="group"
    aria-label="Evidence board: each exhibit as a case card, joined by its relationships"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <rect {width} {height} fill="transparent" onclick={() => onselect(null)} />
    <g transform={transform.toString()}>
      <g class="edges">
        {#each routes as route (route.key)}
          <path class="e" class:weak={route.weak} class:near={nearLink(route)} class:inked={inked(route)} d={route.d} />
        {/each}
        {#key active}
          {#each routes.filter(inked) as route (route.key)}
            <path class="e-ink" d={route.d} pathLength="1" />
          {/each}
        {/key}
        {#each routes as route (route.key)}
          <g class="e-l" class:near={nearLink(route)} transform="translate({route.mx} {route.my})"><text text-anchor="middle" y="5">{route.rel}</text></g>
        {/each}
      </g>
      <g class="nodes">
        {#each drawn as node (node.id)}
          {@const at = placed.get(node.id) ?? { x: 0, y: 0 }}
          <g
            class="n"
            class:near={near?.has(node.id)}
            class:sel={node.id === active}
            class:ghost={node.ghost}
            class:weak={node.weak}
            transform="translate({at.x} {at.y})"
            style="--c: {node.colour}"
            role="button"
            tabindex="0"
            aria-label={describe(node)}
            aria-pressed={node.id === active}
            data-id={node.id}
            onclick={(event) => pick(event, node.id)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                pick(event, node.id)
              }
            }}
          >
            <g class="body">
              <rect class="card" x={-CARD.w / 2} y={-CARD.h / 2} width={CARD.w} height={CARD.h} rx="10" />
              <path class="head" d="M{-CARD.w / 2},{-CARD.h / 2 + 10} a10,10 0 0 1 10,-10 h{CARD.w - 20} a10,10 0 0 1 10,10 v10 h{-CARD.w}z" />
              <text class="id" x={-CARD.w / 2 + 14} y={-CARD.h / 2 + 15}>{fit(node.ghost ? 'REF' : node.id, 26)}</text>
              <text class="code" x={CARD.w / 2 - 14} y={-CARD.h / 2 + 15} text-anchor="end">{node.ghost ? '' : node.code}</text>
              <text class="t" x={-CARD.w / 2 + 14} y="4">{fit(node.title, 24)}</text>
              {#if !node.ghost}
                <rect class="wbar" x={-CARD.w / 2 + 14} y="18" width="90" height="3" rx="1.5" />
                <rect class="wfill" x={-CARD.w / 2 + 14} y="18" width={90 * (node.weight ?? 0)} height="3" rx="1.5" />
                <text class="w" x={-CARD.w / 2 + 112} y="22">{percent(node.weight)}{node.note ? ` · ${node.note}` : ''}</text>
              {/if}
              <circle class="seal" cx={CARD.w / 2 - 14} cy={-CARD.h / 2} r="12" />
            </g>
          </g>
        {/each}
      </g>
    </g>
  </svg>

  <div class="spot" class:on={spot !== null} style={spot ? `--lx: ${spot.x}px; --ly: ${spot.y}px; --lr: ${spot.r}px` : undefined} aria-hidden="true"></div>

  <div class="ui top">
    {#if find}
      <label class="find">
        <Search size={14} aria-hidden="true" />
        <span class="sr-only">Find an exhibit on the board</span>
        <input
          type="search"
          placeholder="Name or id"
          bind:value={query}
          onkeydown={(event) => {
            const first = found ? drawn.find((node) => found.has(node.id)) : undefined
            if (event.key === 'Enter' && first) onselect(first.id)
          }}
          data-testid="find-exhibit"
        />
      </label>
    {/if}
    {@render toolbar?.()}
  </div>
  <div class="ui bottom">
    <button type="button" class="tool square" aria-label="Zoom in" onclick={() => zoomBy(1.4)}><Plus size={15} aria-hidden="true" /></button>
    <button type="button" class="tool square" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.4)}><Minus size={15} aria-hidden="true" /></button>
    <button type="button" class="tool square" aria-label="Fit everything" onclick={() => (active ? onselect(null) : home())}><Maximize size={15} aria-hidden="true" /></button>
    <button type="button" class="tool" aria-pressed={labels} onclick={() => (labels = !labels)}>Relationship labels</button>
  </div>
  {#if hint && width >= 760}
    <p class="ui hint" aria-hidden="true">pick a card to bring its links forward · drag to pan · scroll to zoom</p>
  {/if}

  {#if drawn.length === 0}
    <div class="empty">
      <p class="empty-title">No exhibits on the board</p>
      <p class="empty-hint">{emptyHint}</p>
    </div>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    height: 100%;
    min-height: 16rem;
    overflow: hidden;
    border-radius: 14px;
    background: var(--bg) radial-gradient(circle, var(--rule-2) 1px, transparent 1.2px) 0 0 / 24px 24px;
    box-shadow: var(--shadow-1);
    touch-action: none;
  }
  .net {
    display: block;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
  }
  .net:active {
    cursor: grabbing;
  }

  /* Connectors: hairlines, dashed when weak; the picked exhibit's draw in red ink. */
  .e {
    fill: none;
    stroke: var(--rule-2);
    stroke-width: 1.3;
    transition:
      opacity 0.35s,
      stroke 0.3s;
  }
  .e.weak {
    stroke-dasharray: 3 4;
  }
  .e.near {
    stroke: var(--ink-2);
  }
  .e.inked {
    stroke: transparent;
  }
  .dim .e:not(.near) {
    opacity: 0.15;
  }
  .e-ink {
    fill: none;
    stroke: var(--signal);
    stroke-width: 1.6;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    pointer-events: none;
    animation: draw 0.8s var(--ease-io) forwards;
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  .e-l {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
  }
  .e-l text {
    font: italic 400 15px var(--serif);
    fill: var(--signal);
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 5px;
    stroke-linejoin: round;
  }
  .dim .e-l.near,
  .has-labels .e-l {
    opacity: 1;
  }
  .has-labels .e-l:not(.near) text {
    fill: var(--mute);
  }
  .has-labels .dim.net .e-l:not(.near) {
    opacity: 0.25;
  }

  /* Cards: a type-tinted head, serif title, confidence bar; focus plus context. */
  .n {
    cursor: pointer;
    outline: none;
    transition: opacity 0.35s;
  }
  .n .body {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 0.45s var(--ease-out);
  }
  .dim .n:not(.near) {
    opacity: 0.22;
  }
  .dim .n:not(.near) .body {
    transform: scale(0.82);
  }
  .n.sel .body {
    transform: scale(1.12);
  }
  .card {
    fill: var(--paper);
    stroke: var(--rule-2);
    stroke-width: 1;
    filter: drop-shadow(0 2px 3px rgb(20 16 8 / 0.06));
    transition: stroke 0.2s;
  }
  .head {
    fill: color-mix(in oklab, var(--c) 14%, var(--paper));
  }
  .id {
    font: 600 10.5px var(--mono);
    letter-spacing: 0.03em;
    fill: color-mix(in oklab, var(--c) 80%, var(--ink));
  }
  .code {
    font: 700 9.5px var(--mono);
    letter-spacing: 0.08em;
    fill: var(--c);
  }
  .t {
    font: 400 20px var(--serif);
    fill: var(--ink);
  }
  .wbar {
    fill: var(--rule);
  }
  .wfill {
    fill: var(--ink-2);
  }
  .w {
    font: 500 10.5px var(--mono);
    fill: var(--mute);
  }
  .seal {
    fill: var(--paper);
    stroke: var(--signal);
    stroke-width: 1.4;
    stroke-dasharray: 3 3;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    transition: opacity 0.3s;
  }
  .n.weak .card {
    stroke: var(--signal);
    stroke-dasharray: 4 3;
  }
  .n.weak .wfill {
    fill: var(--signal);
  }
  .n.ghost .card {
    fill: transparent;
    stroke-dasharray: 3 4;
  }
  .n.ghost .head {
    fill: transparent;
  }
  .n.ghost .t {
    fill: var(--mute);
  }
  .n:hover .card {
    stroke: var(--ink-2);
  }
  .n:focus-visible .card {
    stroke: var(--signal);
    stroke-width: 2;
  }
  .n.sel .card {
    stroke: var(--signal);
    stroke-width: 2;
  }
  .n.sel .seal {
    opacity: 1;
    animation: spin 12s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* The paper spotlight round the framed neighbourhood. */
  .spot {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    background: radial-gradient(
      circle at var(--lx, 50%) var(--ly, 50%),
      transparent 0,
      transparent var(--lr, 160px),
      color-mix(in oklab, var(--paper) 72%, transparent) calc(var(--lr, 160px) + 140px)
    );
    transition: opacity 0.6s var(--ease-out);
  }
  .spot.on {
    opacity: 1;
  }

  .ui {
    position: absolute;
    display: flex;
    gap: 6px;
  }
  .top {
    top: 12px;
    left: 12px;
    right: 12px;
    flex-wrap: wrap;
    align-items: center;
    pointer-events: none;
  }
  .top > :global(*) {
    pointer-events: auto;
  }
  .bottom {
    left: 12px;
    bottom: 12px;
  }
  .hint {
    right: 12px;
    bottom: 12px;
    margin: 0;
    padding: 6px 10px;
    border: 1px solid var(--rule);
    border-radius: 7px;
    background: color-mix(in oklab, var(--paper) 92%, transparent);
    color: var(--mute);
    font: 11px var(--mono);
  }
  .find {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: 7px;
    background: color-mix(in oklab, var(--paper) 92%, transparent);
    color: var(--mute);
  }
  .find input {
    width: 150px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 12.5px;
  }
  .ui :global(.tool) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: 7px;
    background: color-mix(in oklab, var(--paper) 92%, transparent);
    color: var(--ink-2);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    backdrop-filter: blur(6px);
    transition: border-color 0.2s;
  }
  .ui :global(.tool:hover) {
    border-color: var(--rule-2);
  }
  .ui :global(.tool[aria-pressed='true']) {
    border-color: var(--ink-2);
    color: var(--ink);
  }
  .ui :global(.tool[aria-pressed='false']) {
    color: var(--mute);
  }
  .ui :global(.tool.square) {
    justify-content: center;
    width: 32px;
    padding: 0;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    padding: 1.5rem;
    text-align: center;
    pointer-events: none;
  }
  .empty p {
    margin: 0.2rem 0;
  }
  .empty-title {
    font-family: var(--serif);
    font-size: 1.35rem;
  }
  .empty-hint {
    color: var(--mute);
    font-size: 0.875rem;
  }
  @media (max-width: 900px) {
    .find input {
      width: 110px;
    }
    .hint {
      display: none;
    }
  }
</style>
