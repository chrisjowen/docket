<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts" module>
  /** One record as its case card shows it. Ghosts are references no document files yet. */
  export interface CardNode {
    id: string
    title: string
    type: string
    ghost: boolean
    /** The type's short code, SVC, API ... */
    code: string
    colour: string
    /** Weight of evidence, 0 to 1, when assessed. */
    weight: number | null
    /** How many exhibits it has on file; null where that is not known, as in a search's board. */
    exhibits: number | null
    /** A standing worth flagging on the card: Pending, Overruled, Uncorroborated, Not on record, Low. */
    flag: string | null
    overruled: boolean
    weak: boolean
    /** Evidence observed in the last week: the card glows. */
    recent: boolean
    /** Its confidence band, by the workspace's bands; null for a reference. */
    band?: Band | null
    /** A pending proposal would replace it: drawn striped until it is proven or refused. */
    pending?: boolean
  }

  export interface CardLink {
    key: string
    source: string
    target: string
    rel: string
    weak: boolean
    /** A proposed `supersedes`, not yet fact: drawn striped amber. */
    pending?: boolean
  }
</script>

<script lang="ts">
  import { Maximize, Minus, Plus, Search } from '@lucide/svelte'
  import { select } from 'd3-selection'
  import 'd3-transition'
  import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
  import { onMount, untrack, type Snippet } from 'svelte'

  import { matches } from '$lib/graph/browse'
  import { CARD, boxOf, connector, type Box, type Point } from '$lib/graph/cards'
  import { neighbourhood } from '$lib/graph/model'
  import { reducedMotion } from '$lib/motion'
  import type { Band } from '$lib/trust/bands'

  /**
   * The Record's network as case cards on a dotted canvas, joined by curved
   * connectors. Picking a card zooms to fit it and everything one link away
   * into whatever part of the canvas the record drawer leaves free; the rest
   * shrink and fade behind a paper spotlight, and its connectors draw in red.
   */
  interface Props {
    nodes: CardNode[]
    links: CardLink[]
    /** Every card's centre: laid out once for the whole graph, so a filter never moves a card. */
    placed: ReadonlyMap<string, Point>
    selected: string | null
    onselect: (id: string | null) => void
    /** The record drawer: its part of the canvas is left out when a record is framed. */
    occluder?: HTMLElement | null
    /** More controls beside the search, in the canvas's top row. */
    toolbar?: Snippet
    emptyHint?: string
    /** Cards kept at full strength while nothing is picked or found; null: every card. */
    emphasis?: ReadonlySet<string> | null
    /** The box that finds a record on the board; off where the toolbar brings a search of its own. */
    find?: boolean
    /** Fill the parent's height, unframed, instead of sitting on the page as a card. */
    fill?: boolean
    /** Changes whenever the board is chosen afresh - a query, more records, full screen - and the board frames it again. */
    frame?: string
    /** More controls beside the zoom buttons, in the canvas's bottom row. */
    actions?: Snippet
    /** Ring each card in its confidence band's colour rather than its type's. */
    byConfidence?: boolean
    /** What a card's hover or focus card says about the record. */
    tip?: Snippet<[string]>
    /** A key to the board, in its bottom corner. */
    legend?: Snippet
  }

  let {
    nodes,
    links,
    placed,
    selected,
    onselect,
    occluder = null,
    toolbar,
    emptyHint = 'Switch record types on above.',
    emphasis = null,
    find = true,
    fill = false,
    frame = '',
    actions,
    byConfidence = false,
    tip,
    legend,
  }: Props = $props()
  const uid = $props.id()

  let svg = $state<SVGSVGElement>()
  let canvas = $state<HTMLDivElement>()
  let width = $state(0)
  let height = $state(0)
  /** The top row's height: the board is framed below its controls. */
  let controls = $state(0)
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
    }),
  )
  const active = $derived(selected !== null && shown.has(selected) ? selected : null)
  const found = $derived(query.trim() ? new Set(nodes.filter((node) => matches([node.title, node.id, node.type, node.code], query)).map((node) => node.id)) : null)
  /** Cards kept at full strength: the selection and its neighbours, else what the search finds, else the emphasis. */
  const near = $derived(active ? neighbourhood(links, active) : (found ?? emphasis))
  const nearLink = (link: CardLink) => active !== null && (link.source === active || link.target === active)

  /** The card a pointer rests on or the keyboard has reached: its hover card shows beside it. */
  let tipped = $state<string | null>(null)
  const tipAt = $derived.by(() => {
    const at = tipped ? placed.get(tipped) : undefined
    if (!at) return null
    const right = transform.applyX(at.x + CARD.w / 2) + 12
    const left = transform.applyX(at.x - CARD.w / 2) - 12 - 300
    return { x: right + 300 > width - 8 && left > 8 ? left : Math.min(right, Math.max(8, width - 308)), y: Math.max(8, Math.min(transform.applyY(at.y - CARD.h / 2), height - 260)) }
  })

  const fit = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)
  const exhibitsOf = (count: number | null, short: boolean) =>
    count === null ? '' : `${short ? ' · ' : ', '}${count} ${short ? 'ex.' : count === 1 ? 'exhibit' : 'exhibits'}`
  const describe = (node: CardNode) =>
    node.ghost
      ? `${node.id}, not on record`
      : `${node.title}, ${node.type} ${node.id}, confidence ${node.weight === null ? 'not assessed' : node.weight.toFixed(2)}${node.band ? ` ${node.band}` : ''}${exhibitsOf(node.exhibits, false)}${node.flag ? `, ${node.flag.toLowerCase()}` : ''}${node.pending ? ', pending proposal' : ''}`

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

  /** The whole board in view. */
  function home(animate = true): void {
    spot = null
    const box = boxOf(shown, placed)
    if (!box || width === 0) return
    let padded = { x: box.x - 50, y: box.y - 70, w: box.w + 100, h: box.h + 120 }
    // On a phone, start closer in: half the board across, centred.
    if (width < 600) padded = { ...padded, x: padded.x + padded.w / 4, w: padded.w / 2 }
    const top = Math.max(50, controls + 20)
    moveTo(framing(padded, { x: 10, y: top, w: width - 20, h: Math.max(120, height - top - 10) }, 1.2), animate ? 600 : 0)
  }

  /** The part of the canvas the drawer leaves free, below the canvas's own top row. */
  function freeRegion(): Box {
    const top = Math.max(56, controls + 24)
    const region = { x: 16, y: top, w: width - 32, h: Math.max(140, height - top - 34) }
    let box = canvas?.getBoundingClientRect()
    const cover = occluder?.getBoundingClientRect()
    // A bottom sheet covers the lower screen: bring the canvas up under the top bar first.
    if (box && cover && cover.left <= 1 && cover.top > 0 && box.top + 140 > cover.top) {
      window.scrollTo({ top: window.scrollY + box.top - 58, behavior: 'instant' })
      box = canvas?.getBoundingClientRect()
    }
    if (!box || !cover || cover.width === 0) return region
    if (cover.top > box.top + 40 && cover.left <= box.left + 1) {
      // A bottom sheet: only what is above it.
      region.h = Math.max(140, Math.min(region.h, cover.top - box.top - region.y - 12))
    } else if (cover.left < box.right) {
      region.w = Math.max(240, Math.min(region.w, cover.left - box.left - region.x - 16))
    }
    return region
  }

  /** Frame the record and its neighbours, then light it. */
  function focusOn(id: string): void {
    const ids = [...neighbourhood(links, id)].filter((each) => shown.has(each))
    const box = boxOf(ids, placed)
    const at = placed.get(id)
    if (!box || !at) return
    spot = null
    const next = framing({ x: box.x - 60, y: box.y - 60, w: box.w + 120, h: box.h + 120 }, freeRegion(), 1.6)
    moveTo(next, 760, () => {
      const reach = Math.max(...ids.map((each) => {
        const other = placed.get(each)
        return other ? Math.hypot(other.x - at.x, other.y - at.y) : 0
      }))
      spot = { x: next.applyX(at.x), y: next.applyY(at.y), r: Math.max(150, reach * next.k + 140 * next.k) }
    })
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

  // The first frame, once the canvas has a size: the board, or straight to the record a link names.
  let framed = false
  $effect(() => {
    if (framed || width === 0 || height === 0 || !behaviour || drawn.length === 0) return
    framed = true
    untrack(() => {
      home(false)
      if (active) requestAnimationFrame(() => requestAnimationFrame(() => active && focusOn(active)))
      last = active
    })
  })

  // A new selection is framed once the drawer has opened; clearing it goes back to the whole board.
  let last: string | null = null
  $effect(() => {
    const now = active
    if (!framed || now === last) return
    last = now
    untrack(() => {
      if (now) requestAnimationFrame(() => requestAnimationFrame(() => focusOn(now)))
      else home()
    })
  })

  // A board chosen afresh is framed again, once the canvas has its new size.
  let lastFrame = untrack(() => frame)
  $effect(() => {
    const now = frame
    if (now === lastFrame) return
    lastFrame = now
    if (!framed) return
    untrack(() => requestAnimationFrame(() => requestAnimationFrame(() => (active ? focusOn(active) : home()))))
  })

  const zoomBy = (factor: number) => {
    if (!svg || !behaviour) return
    spot = null
    const target = select(svg).interrupt()
    if (reducedMotion()) target.call(behaviour.scaleBy, factor)
    else target.transition().duration(380).call(behaviour.scaleBy, factor)
  }

  const pick = (event: Event, id: string) => {
    event.stopPropagation()
    onselect(id)
  }
</script>

<div class="canvas" class:has-labels={labels} class:fill bind:this={canvas} bind:clientWidth={width} bind:clientHeight={height} data-testid="board" data-nodes={drawn.length} data-links={routes.length}>
  <svg bind:this={svg} {width} {height} class="net" class:dim={near !== null} role="group" aria-label="Evidence network: each record as a case card, joined by its relations. An index of records follows.">
    <defs>
      <pattern id="{uid}-stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" class="stripe-bg" />
        <rect width="3.5" height="8" class="stripe" />
      </pattern>
    </defs>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <rect {width} {height} fill="transparent" onclick={() => onselect(null)} />
    <g transform={transform.toString()}>
      <g class="edges">
        {#each routes as route (route.key)}
          <path class="e" class:weak={route.weak} class:pending={route.pending} class:near={nearLink(route)} d={route.d} />
        {/each}
        {#key active}
          {#each routes.filter(nearLink) as route (route.key)}
            <path class="e-ink" d={route.d} pathLength="1" />
          {/each}
        {/key}
        {#each routes as route (route.key)}
          <g class="e-l" class:near={nearLink(route)} class:pending={route.pending} transform="translate({route.mx} {route.my})"><text text-anchor="middle" y="5">{route.rel}{route.pending ? ' ?' : ''}</text></g>
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
            class:overruled={node.overruled}
            class:recent={node.recent}
            class:pend={node.pending}
            class:b-ok={byConfidence && node.band === 'established'}
            class:b-warn={byConfidence && node.band === 'probable'}
            class:b-red={byConfidence && node.band === 'unverified'}
            transform="translate({at.x} {at.y})"
            style="--c: {node.colour}; --stripes: url(#{uid}-stripes)"
            role="button"
            tabindex="0"
            aria-label={describe(node)}
            aria-pressed={node.id === active}
            aria-describedby={tip && tipped === node.id ? `${uid}-tip` : undefined}
            data-id={node.id}
            data-band={node.band ?? undefined}
            onclick={(event) => pick(event, node.id)}
            onpointerenter={() => (tipped = node.ghost ? null : node.id)}
            onpointerleave={() => tipped === node.id && (tipped = null)}
            onfocus={() => (tipped = node.ghost ? null : node.id)}
            onblur={() => tipped === node.id && (tipped = null)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                pick(event, node.id)
              } else if (event.key === 'Escape' && tipped) {
                // Escape puts the hover card away first; the next closes the drawer.
                event.preventDefault()
                tipped = null
              }
            }}
          >
            <g class="body">
              <rect class="card" x={-CARD.w / 2} y={-CARD.h / 2} width={CARD.w} height={CARD.h} rx="10" />
              {#if node.pending}<rect class="stripes" x={-CARD.w / 2} y={-CARD.h / 2} width={CARD.w} height={CARD.h} rx="10" />{/if}
              <path class="head" d="M{-CARD.w / 2},{-CARD.h / 2 + 10} a10,10 0 0 1 10,-10 h{CARD.w - 20} a10,10 0 0 1 10,10 v10 h{-CARD.w}z" />
              <text class="id" x={-CARD.w / 2 + 14} y={-CARD.h / 2 + 15}>{fit(node.ghost ? 'REF' : node.id, node.flag ? 15 : 26)}</text>
              {#if node.flag}
                <text class="flag" class:warn={node.pending} x={CARD.w / 2 - 14} y={-CARD.h / 2 + 15} text-anchor="end">{node.flag.toUpperCase()}</text>
              {:else}
                <text class="code" x={CARD.w / 2 - 14} y={-CARD.h / 2 + 15} text-anchor="end">{node.code}</text>
              {/if}
              <text class="t" x={-CARD.w / 2 + 14} y="4">{fit(node.ghost ? node.id : node.title, 24)}</text>
              {#if !node.ghost}
                <rect class="wbar" x={-CARD.w / 2 + 14} y="18" width="90" height="3" rx="1.5" />
                <rect class="wfill" x={-CARD.w / 2 + 14} y="18" width={90 * (node.weight ?? 0)} height="3" rx="1.5" />
                <text class="w" x={-CARD.w / 2 + 112} y="22">{node.weight === null ? '—' : node.weight.toFixed(2)}{exhibitsOf(node.exhibits, true)}</text>
              {/if}
              <circle class="seal" cx={CARD.w / 2 - 14} cy={-CARD.h / 2} r="12" />
            </g>
          </g>
        {/each}
      </g>
    </g>
  </svg>

  {#if tip && tipped && tipAt}
    <div class="tip" id="{uid}-tip" role="tooltip" style="left: {tipAt.x}px; top: {tipAt.y}px" data-testid="card-tip">{@render tip(tipped)}</div>
  {/if}

  <div class="spot" class:on={spot !== null} style={spot ? `--lx: ${spot.x}px; --ly: ${spot.y}px; --lr: ${spot.r}px` : undefined} aria-hidden="true"></div>

  <div class="ui top" bind:clientHeight={controls}>
    {#if find}<label class="find">
      <Search size={14} aria-hidden="true" />
      <span class="visually-hidden">Find a record</span>
      <input
        type="search"
        placeholder="Name or record no."
        bind:value={query}
        onkeydown={(event) => {
          const first = found ? drawn.find((node) => found.has(node.id)) : undefined
          if (event.key === 'Enter' && first) onselect(first.id)
        }}
        data-testid="find-record"
      />
    </label>{/if}
    {@render toolbar?.()}
  </div>
  <div class="ui bottom">
    <button type="button" class="tool square" aria-label="Zoom in" onclick={() => zoomBy(1.4)}><Plus size={15} aria-hidden="true" /></button>
    <button type="button" class="tool square" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.4)}><Minus size={15} aria-hidden="true" /></button>
    <button type="button" class="tool square" aria-label="Fit everything" onclick={() => (active ? onselect(null) : home())}><Maximize size={15} aria-hidden="true" /></button>
    <button type="button" class="tool" aria-pressed={labels} onclick={() => (labels = !labels)}>Relation labels</button>
    {@render actions?.()}
  </div>
  {#if legend}
    <div class="ui legend">{@render legend()}</div>
  {:else}
    <p class="ui hint" aria-hidden="true">focus + context: the picked card grows, the rest recede · drag to pan · scroll to zoom</p>
  {/if}

  {#if drawn.length === 0}
    <div class="empty">
      <p class="empty-title">No records on the board</p>
      <p class="muted">{emptyHint}</p>
    </div>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    height: min(74vh, 780px);
    min-height: 26rem;
    overflow: hidden;
    border-radius: 14px;
    background: var(--bg) radial-gradient(circle, var(--rule-2) 1px, transparent 1.2px) 0 0 / 24px 24px;
    box-shadow: var(--shadow-1);
    touch-action: none;
  }
  .canvas.fill {
    height: 100%;
    min-height: 0;
    border-radius: 0;
    box-shadow: none;
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

  /* Connectors: hairlines, dashed when weak; the picked record's draw in red ink. */
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
  .e.pending {
    stroke: var(--warn);
    stroke-width: 2.2;
    stroke-dasharray: 7 5;
  }
  .e-l.pending {
    opacity: 1;
  }
  .e-l.pending text {
    fill: var(--warn);
  }
  .e.near {
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
    font: italic 400 15px var(--font-serif);
    fill: var(--signal);
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 5px;
    stroke-linejoin: round;
  }
  .e-l.near,
  .has-labels .e-l {
    opacity: 1;
  }
  .has-labels .e-l:not(.near) text {
    fill: var(--mute);
  }
  .dim.net .e-l:not(.near) {
    opacity: 0;
  }
  .has-labels .dim.net .e-l:not(.near) {
    opacity: 0.25;
  }

  /* Cards: a type-tinted head, serif title, weight bar; focus plus context. */
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
    opacity: 0.16;
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
    font: 600 10.5px var(--font-mono);
    letter-spacing: 0.03em;
    fill: color-mix(in oklab, var(--c) 80%, var(--ink));
  }
  .code {
    font: 700 9.5px var(--font-mono);
    letter-spacing: 0.08em;
    fill: var(--c);
  }
  .flag {
    font: 700 9px var(--font-mono);
    letter-spacing: 0.08em;
    fill: var(--signal);
  }
  .t {
    font: 400 20px var(--font-serif);
    fill: var(--ink);
  }
  .wbar {
    fill: var(--rule);
  }
  .wfill {
    fill: var(--ink-2);
  }
  .w {
    font: 500 10.5px var(--font-mono);
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
  /* By confidence: each card ringed in its band's colour; Unverified dashed and tinted. */
  .n.b-ok .card {
    stroke: var(--ok);
    stroke-width: 1.8;
    stroke-dasharray: none;
  }
  .n.b-warn .card {
    stroke: var(--warn);
    stroke-width: 1.8;
    stroke-dasharray: none;
  }
  .n.b-red .card {
    fill: color-mix(in oklab, var(--signal-soft) 55%, var(--paper));
    stroke: var(--signal);
    stroke-width: 1.8;
    stroke-dasharray: 4 3;
  }
  .n.b-ok .head {
    fill: color-mix(in oklab, var(--ok) 16%, var(--paper));
  }
  .n.b-warn .head {
    fill: color-mix(in oklab, var(--warn) 16%, var(--paper));
  }
  .n.b-red .head {
    fill: color-mix(in oklab, var(--signal) 16%, var(--paper));
  }
  .n.b-ok .wfill {
    fill: var(--ok);
  }
  .n.b-warn .wfill {
    fill: var(--warn);
  }
  .n.b-red .wfill {
    fill: var(--signal);
  }
  /* A pending proposal would replace it: striped amber until it is proven or refused. */
  .stripes {
    fill: var(--stripes);
    pointer-events: none;
  }
  .stripe-bg {
    fill: transparent;
  }
  .stripe {
    fill: color-mix(in oklab, var(--warn) 13%, transparent);
  }
  .n.pend .card {
    stroke: var(--warn);
    stroke-dasharray: 6 3;
  }
  .flag.warn {
    fill: var(--warn);
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
  .n.overruled .t {
    text-decoration: line-through;
    fill: var(--mute);
  }
  .n.recent .card {
    animation: card-glow 2.8s ease-in-out infinite;
  }
  @keyframes card-glow {
    50% {
      stroke: color-mix(in oklab, var(--c) 70%, var(--paper));
    }
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
  /* Above the zoom row, so neither covers the other on a narrow canvas. */
  .legend {
    right: 12px;
    bottom: 54px;
    max-width: calc(100% - 24px);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  /* The hover card: dark, beside the card, never in the pointer's way. */
  .tip {
    position: absolute;
    z-index: 3;
    width: 300px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--ink);
    color: var(--paper);
    box-shadow: var(--shadow-2, 0 8px 24px rgb(0 0 0 / 0.2));
    font-size: 12.5px;
    pointer-events: none;
    animation: rise 0.18s var(--ease-out) both;
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
    font: 11px var(--font-mono);
  }
  .find {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--rule);
    border-radius: 7px;
    background: color-mix(in oklab, var(--paper) 92%, transparent);
    color: var(--mute);
    font-weight: 400;
  }
  .find input {
    width: 170px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
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
    font-family: var(--font-serif);
    font-size: 1.25rem;
  }
  @media (max-width: 900px) {
    .canvas {
      height: 66vh;
      min-height: 22rem;
      border-radius: 12px;
    }
    .find input {
      width: 110px;
    }
    .hint {
      display: none;
    }
    .legend {
      left: 12px;
      bottom: 60px;
      justify-content: flex-start;
    }
    .tip {
      display: none;
    }
    /* Touch targets: a finger's width. */
    .ui :global(.tool) {
      height: 40px;
    }
    .ui :global(.tool.square) {
      width: 40px;
    }
    .find {
      height: 40px;
    }
  }
</style>
