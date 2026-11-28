<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { enhance } from '$app/forms'
  import { resolve } from '$app/paths'
  import { invalidateAll, replaceState } from '$app/navigation'
  import { page } from '$app/state'
  import { Hourglass, Maximize2, Minimize2, Network, PenLine, RefreshCw, Search, SlidersHorizontal, TriangleAlert, X } from '@lucide/svelte'
  import { onMount, tick, untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'

  import Csrf from '$lib/components/csrf.svelte'
  import CapturePanel from '$lib/components/graph/capture-panel.svelte'
  import CardGraph, { type CardNode } from '$lib/components/graph/card-graph.svelte'
  import CaseFile from '$lib/components/graph/case-file.svelte'
  import EvidenceView from '$lib/components/graph/evidence-view.svelte'
  import FactsView from '$lib/components/graph/facts-view.svelte'
  import Filters from '$lib/components/graph/filters.svelte'
  import TimelineView from '$lib/components/graph/timeline-view.svelte'
  import { facets, passes } from '$lib/ask/model'
  import { typeCode } from '$lib/docket'
  import { dayOf, docketSheet, exhibitsOf, isAbout, timelineOf, type Exhibit, type GraphHistory } from '$lib/graph/browse'
  import { layoutCards } from '$lib/graph/cards'
  import { iconOf } from '$lib/graph/icons'
  import { countBy, edgeKey, slotColour, typeSlots, visible } from '$lib/graph/model'
  import { factNotes } from '$lib/graph/notes'
  import { BOARD_LIMIT, cappedScope, resultScope } from '$lib/graph/scope'
  import { exhibitLabel } from '$lib/graph/sheet'
  import { exhibitCount, standingOf, weightOf } from '$lib/graph/standing'
  import { parseQuery, passesTokens, QUICK_QUERIES, TOKEN_HINTS, type TokenSubject } from '$lib/graph/tokens'
  import { setTypeStyle } from '$lib/graph/type-style'
  import { readState, switchView, writeState, type BrowseState, type View } from '$lib/graph/view-state'
  import { BAND_LABELS, BAND_STAMP, BANDS, bandRange, DEFAULT_BANDS } from '$lib/trust/bands'

  let { data, form } = $props()

  const graph = $derived(data.graph)
  const index = $derived(graph.index)
  const docketNo = $derived(data.dockets.find((entry) => entry.slug === data.workspace.slug)?.docketNo ?? '')

  // A type keeps its colour and icon however the board is filtered.
  const slots = $derived(typeSlots(graph.entities))
  const icons = $derived(new Map(graph.types.map((type) => [type.name, type.icon])))
  const colourOf = (type: string) => slotColour(slots.get(type))
  setTypeStyle({ colour: colourOf, icon: (type) => iconOf(icons.get(type)) })

  const hiddenTypes = new SvelteSet<string>()
  const hiddenRels = new SvelteSet<string>()
  let showUnresolved = $state(true)
  let filtering = $state(false)

  /**
   * Which view, its filters and the selection live in the address, so each
   * can be linked to. Changing them rewrites the address in place (no load
   * runs); following a link to another address reads it afresh.
   */
  let browse = $state<BrowseState>(readState(page.url.searchParams))
  let read = page.url.href
  $effect(() => {
    if (page.url.href === read) return
    read = page.url.href
    browse = readState(page.url.searchParams)
  })
  let pending: ReturnType<typeof setTimeout> | undefined
  const update = (change: Partial<BrowseState>, typing = false) => {
    browse = { ...browse, ...change }
    clearTimeout(pending)
    // While someone types, write the address once they pause: browsers cap how often it may change.
    pending = setTimeout(
      () => {
        const search = writeState(browse).toString()
        const here = resolve('/a/[acct]/d/[docket]/graph', { acct: data.org.slug, docket: data.workspace.slug })
        // eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own resolved path, with its state as the query
        replaceState(search ? `${here}?${search}` : here, page.state)
      },
      typing ? 300 : 0,
    )
  }
  const filterChange = (change: Partial<BrowseState>) => update(change, 'q' in change)
  const selected = $derived(browse.id)

  /**
   * Full screen: the network fills the window, and the browser's full screen
   * is asked for too where it is allowed. Its Escape, or the page's when the
   * browser's is not on, leaves both.
   */
  const full = $derived(browse.view === 'graph' && browse.full)
  const setFull = (on: boolean) => {
    update({ full: on })
    if (on && !document.fullscreenElement && document.fullscreenEnabled) void document.documentElement.requestFullscreen().catch(() => {})
    else if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }
  $effect(() => {
    if (!full && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  })

  // The capture forms stay open after a refusal, so the diagnostics can be read and fixed.
  let capturing = $state(false)
  $effect(() => {
    if (form?.capture && !form.capture.done) capturing = true
  })

  /**
   * The docket sheet and exhibits views, and an open case file's docket
   * entries, also read the activity log and every document's origin: asked
   * for when one of them opens, and again after a capture writes, never on
   * the board's own load or its index poll.
   */
  let history = $state<GraphHistory | null>(null)
  let failed = $state(false)
  let version = $state(0)
  const drawerOpen = $derived(capturing || selected !== null)
  const needsHistory = $derived(browse.view === 'timeline' || browse.view === 'evidence' || (drawerOpen && !capturing))
  const historyUrl = $derived(resolve('/a/[acct]/d/[docket]/graph/history', { acct: data.org.slug, docket: data.workspace.slug }))
  $effect(() => {
    if (form?.capture?.done) {
      untrack(() => version++)
      history = null
      failed = false
    }
  })
  $effect(() => {
    void version
    if (!needsHistory || history || failed) return
    let current = true
    fetch(historyUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`The activity log answered ${response.status}.`)
        return response.json() as Promise<GraphHistory>
      })
      .then((loaded) => {
        if (current) history = loaded
      })
      .catch(() => {
        if (current) failed = true
      })
    return () => {
      current = false
    }
  })

  const byId = $derived(new Map(graph.entities.map((item) => [item.id, item])))
  const entity = $derived(selected ? byId.get(selected) : undefined)

  /** Every exhibit in the docket, numbered as filed, with its label. */
  const exhibits = $derived(new Map(exhibitsOf(graph).map((exhibit) => [exhibit.key, { ...exhibit, label: exhibitLabel(docketNo, exhibit.no) }])))
  const labelOf = (key: string) => exhibits.get(key)?.label
  /** Every fact written as a note, and those about the open record: its own first, then its relations', then those pointing at it. */
  const notes = $derived(factNotes(graph))
  const findingsAbout = $derived.by(() => {
    if (!selected) return []
    const rank = (note: (typeof notes)[number]) => (note.row.entity.id !== selected ? 2 : note.row.link ? 1 : 0)
    return notes.filter((note) => isAbout(note.row, selected)).sort((a, b) => rank(a) - rank(b))
  })
  const sheetEntries = $derived(history ? docketSheet(timelineOf(graph, history.activity)) : null)
  const entriesAbout = $derived(sheetEntries && selected ? sheetEntries.filter((entry) => entry.entity?.id === selected || entry.link?.target === selected) : null)

  /**
   * What the network draws: a large docket's most connected records up to a
   * limit, with more on asking, or only what a query finds and the records one
   * link away. Text goes to the docket's search, as Ask's does; a type or a tag
   * alone filters the records here.
   */
  let limit = $state(BOARD_LIMIT)
  /** The query's tokens filter here, by each record's trust; its other words go to search. */
  const parsed = $derived(parseQuery(browse.q))
  const bands = $derived(graph.trust?.bands ?? DEFAULT_BANDS)
  const subjectOf = (item: (typeof graph.entities)[number]): TokenSubject => ({
    type: item.type,
    confidence: weightOf(item),
    band: item.trust?.band ?? null,
    pending: Boolean(item.trust?.pending),
    sources: item.trust?.sources ?? [],
  })
  const querying = $derived(browse.view === 'graph' && Boolean(browse.q || browse.type || browse.tag))
  const asked = $derived(querying ? JSON.stringify([parsed.text, browse.type, browse.tag]) : '')
  let answer = $state<{ for: string; matched: string[]; notes: string[] } | null>(null)
  let searchFailed = $state<string | null>(null)
  let attempt = $state(0)
  const searchUrl = $derived(resolve('/a/[acct]/d/[docket]/graph/search', { acct: data.org.slug, docket: data.workspace.slug }))
  $effect(() => {
    void attempt
    const key = asked
    if (!key) return
    const [q, type, tag] = JSON.parse(key) as [string, string, string]
    if (!q) return
    const params = new URLSearchParams(Object.entries({ q, type, tag }).filter(([, value]) => value))
    let current = true
    fetch(`${searchUrl}?${params}`)
      .then((response) => {
        if (!response.ok) throw new Error(`The search answered ${response.status}.`)
        return response.json() as Promise<{ matched: string[]; notes: string[] }>
      })
      .then((found) => {
        if (current) answer = { for: key, ...found }
      })
      .catch(() => {
        if (current) searchFailed = key
      })
    return () => {
      current = false
    }
  })
  // A new query starts from the first records again.
  $effect(() => {
    void asked
    limit = BOARD_LIMIT
  })
  /** The query's matches, best first; null with no query, or while the search answers (the last answer stays drawn meanwhile). */
  const matched = $derived.by(() => {
    if (!querying) return null
    const tokensPass = (id: string) => {
      const item = byId.get(id)
      return !parsed.tokens.length || (item !== undefined && passesTokens(subjectOf(item), parsed.tokens))
    }
    if (!parsed.text) return graph.entities.filter((item) => passes(item, { types: browse.type ? [browse.type] : [], tags: browse.tag ? [browse.tag] : [] }) && tokensPass(item.id)).map((item) => item.id)
    return answer?.for === asked ? answer.matched.filter(tokensPass) : null
  })
  const searching = $derived(querying && matched === null && searchFailed !== asked)
  const scope = $derived.by(() => {
    const found = matched ?? (querying && answer ? answer.matched : null)
    return found ? resultScope(graph, found, limit, selected) : cappedScope(graph, limit, selected)
  })
  const emphasis = $derived(scope.matched ? new Set(scope.matched) : null)
  const queryFacets = $derived(facets(graph.entities))

  // The network's query box: its text runs on Enter, a type or tag as soon as it is chosen.
  const typed = $derived(browse.q)
  let draft = $derived(typed)
  const runQuery = (change: Partial<BrowseState> = {}) => {
    searchFailed = null
    update({ q: draft.trim(), ...change })
  }
  /** A quick chip or a legend entry: runs its query, or clears it when it is the one running. */
  const toggleQuery = (q: string) => {
    draft = browse.q.trim() === q ? '' : q
    runQuery()
  }
  const clearQuery = () => {
    draft = ''
    runQuery({ type: '', tag: '' })
  }

  // The board's records laid out together, again only when they change, so a filter or a selection never moves a card.
  const drawnKey = $derived([...scope.graph.entities.map((item) => item.id), '', ...scope.graph.edges.map(edgeKey)].join('\n'))
  const placed = $derived.by(() => {
    void drawnKey
    return untrack(() => {
      const known = new Set(scope.graph.entities.map((item) => item.id))
      const ghosts = [...new Set(scope.graph.edges.filter((edge) => !known.has(edge.target)).map((edge) => edge.target))]
      return layoutCards(
        [...scope.graph.entities.map(({ id, type }) => ({ id, type })), ...ghosts.map((id) => ({ id, type: '' }))],
        scope.graph.edges.map(({ source, target }) => ({ source, target })),
      )
    })
  })
  const board = $derived(visible(scope.graph, hiddenTypes, hiddenRels, showUnresolved))
  /** A week back from today: evidence seen since makes a card glow. */
  const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const cards = $derived<CardNode[]>(
    board.nodes.map((node) => {
      const record = byId.get(node.id)
      if (!record) return { ...node, code: 'REF', colour: 'var(--mute)', weight: null, exhibits: 0, flag: 'Not on record', overruled: false, weak: false, recent: false, band: null, pending: false }
      const standing = standingOf(record)
      const band = record.trust?.band ?? null
      const pending = Boolean(record.trust?.pending)
      return {
        ...node,
        code: typeCode(record.type),
        colour: colourOf(record.type),
        weight: weightOf(record),
        exhibits: exhibitCount(record),
        flag: pending
          ? 'Pending'
          : standing.key === 'overruled'
            ? 'Out of date'
            : standing.key === 'uncorroborated'
              ? standing.label
              : byConfidence && band === 'unverified'
                ? 'Low'
                : null,
        overruled: standing.key === 'overruled',
        weak: standing.key === 'uncorroborated',
        recent: record.evidence.some((item) => (dayOf(item.observedAt) ?? '') >= lastWeek),
        band,
        pending,
      }
    }),
  )
  const byConfidence = $derived(browse.colour === 'confidence')
  /** A link below the Probable band is drawn dashed: the graph scored it by the workspace's bands. */
  const edgeBands = $derived(new Map(graph.edges.map((edge) => [edgeKey(edge), edge.band])))
  const onBoard = $derived(new Set(board.nodes.map((node) => node.id)))
  const cardLinks = $derived([
    ...board.links.map((link) => ({ ...link, weak: edgeBands.get(link.key) === 'unverified' })),
    // A proposed replacement, not yet fact: `supersedes ?`, striped amber, from the replacement to the record it would replace.
    ...(graph.trust?.proposals ?? [])
      .filter((proposal) => onBoard.has(proposal.by) && onBoard.has(proposal.id))
      .map((proposal) => ({ key: `pending:${proposal.proposal}`, source: proposal.by, target: proposal.id, rel: 'supersedes', weak: false, pending: true })),
  ])
  const bandCounts = $derived(new Map(BANDS.map((band) => [band, graph.entities.filter((item) => item.trust?.band === band).length])))
  const pendingCount = $derived(graph.entities.filter((item) => item.trust?.pending).length)
  const types = $derived([...countBy(graph.entities, (item) => item.type)].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)))
  const counts = $derived({ facts: notes.length, exhibits: exhibits.size, sheet: sheetEntries?.length ?? null })

  const VIEW_TABS = $derived<{ view: View; label: string; count: number | null }[]>([
    { view: 'graph', label: 'Network', count: graph.entities.length },
    { view: 'facts', label: 'Facts', count: counts.facts },
    { view: 'timeline', label: 'Docket sheet', count: counts.sheet },
    { view: 'evidence', label: 'Exhibits', count: counts.exhibits },
  ])
  const TITLES: Record<View, [string, string]> = {
    graph: ['Evidence', 'network'],
    facts: ['Findings of', 'fact'],
    timeline: ['Docket', 'sheet'],
    evidence: ['Exhibits', ''],
  }

  let drawer = $state<HTMLElement | null>(null)
  let opener: HTMLElement | null = null

  const select = (id: string | null) => {
    if (id && !selected && document.activeElement instanceof HTMLElement) opener = document.activeElement
    update({ id })
    if (id) capturing = false
  }
  const close = () => {
    if (capturing) capturing = false
    else select(null)
    // Back to whatever opened it, when it is still there.
    const back = opener
    opener = null
    if (back?.isConnected) back.focus({ preventScroll: true })
  }
  /** The network, with this record picked and framed. */
  const showOnBoard = (id: string) => {
    update(switchView(browse, 'graph'))
    select(id)
  }
  const openExhibit = (exhibit: Exhibit) => update({ ...switchView(browse, 'evidence'), doc: exhibit.entity.path })
  /** A finding's note, opened on the Facts view; the case file stays open beside it. */
  const openFinding = (no: string) => update({ ...switchView(browse, 'facts'), open: no })
  /** Every finding about a record, together on the Facts view. */
  const openFindings = () => update({ ...switchView(browse, 'facts'), about: browse.id ?? '' })

  // A case file that opens takes the focus, so the keyboard can read it and Escape can close it.
  $effect(() => {
    const open = drawerOpen && selected
    if (!open || !drawer) return
    void tick().then(() => drawer?.querySelector<HTMLElement>('[data-testid="case-file-close"]')?.focus({ preventScroll: true }))
  })

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    // Escape in a search box with text in it clears the text first.
    if (event.target instanceof HTMLInputElement && event.target.type === 'search' && event.target.value) return
    if (filtering) {
      filtering = false
      return
    }
    if (drawerOpen) close()
    else if (full) setFull(false)
  }

  // The view's tab underline slides between tabs.
  let tabs = $state<HTMLElement>()
  let ink = $state<{ left: number; width: number } | null>(null)
  $effect(() => {
    void browse.view
    void counts.sheet
    const place = () => {
      const tab = tabs?.querySelector<HTMLElement>('[aria-selected="true"]')
      ink = tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null
    }
    place()
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => window.removeEventListener('resize', place)
  })

  /** Instances whose failures reached the threshold, with the adapter's own message (§6.2). */
  const failing = $derived(index.instances.filter((instance) => instance.failures >= 5))
  const upToDate = $derived(index.synced && index.behind === 0 && failing.length === 0)

  // Leaving the browser's full screen leaves the page's too; leaving the page leaves the browser's.
  onMount(() => {
    const left = () => {
      if (!document.fullscreenElement && browse.full) update({ full: false })
    }
    document.addEventListener('fullscreenchange', left)
    return () => {
      document.removeEventListener('fullscreenchange', left)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  })

  onMount(() => {
    // An older link names the record in the fragment: `graph#service.orders`.
    const named = decodeURIComponent(location.hash.slice(1))
    if (named && !browse.id) select(named)
  })

  // Until the index catches up, look again every few seconds; stop once it has.
  onMount(() => {
    const timer = setInterval(() => {
      if (!upToDate && document.visibilityState === 'visible') void invalidateAll()
    }, 5_000)
    return () => clearInterval(timer)
  })
</script>

<svelte:head>
  <title>Record · {data.workspace.name}</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="head">
  <div>
    <h1>{TITLES[browse.view][0]}{#if TITLES[browse.view][1]}&nbsp;<em>{TITLES[browse.view][1]}</em>{/if}</h1>
    <p class="muted lede">
      {graph.entities.length} records and {graph.edges.length} relations, read from {data.workspace.name}'s canonical documents.
    </p>
  </div>
  <div class="head-actions">
    <p class="index" class:ok={upToDate} class:behind={!upToDate} role="status" data-testid="index-status">
      {#if upToDate}
        <span class="live-dot" aria-hidden="true"></span> Index up to date
      {:else if failing.length > 0}
        <TriangleAlert size={16} aria-hidden="true" /> Index behind {index.behind}
      {:else if !index.synced}
        <Hourglass size={16} aria-hidden="true" /> Indexing: {index.behind} to go
      {:else}
        <span class="live-dot behind" aria-hidden="true"></span> Index behind {index.behind}
      {/if}
    </p>
    {#if data.capture.canWrite}
      <button
        class="button small"
        type="button"
        onclick={() => (capturing = !capturing)}
        aria-expanded={capturing}
        data-testid="capture-toggle"
      >
        <PenLine size={14} aria-hidden="true" /> Capture
      </button>
    {/if}
    {#if data.canRebuild}
      <form method="POST" action="?/rebuild" use:enhance>
        <Csrf token={data.csrf} />
        <button class="button small" type="submit" title="Reset this docket's Neo4j and mem0 projections and project every document again">
          <RefreshCw size={14} aria-hidden="true" /> Rebuild index
        </button>
      </form>
    {/if}
  </div>
</div>

{#each failing as instance (instance.id)}
  <p class="alert" role="alert">
    <strong class="mono">{instance.id}</strong> has failed {instance.failures} times in a row and is retrying with backoff:
    {instance.error}. Search answers from the index, so it may miss what the graph shows.
  </p>
{/each}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}
{#if graph.diagnostics.some((d) => d.severity === 'error')}
  <p class="muted small">
    {graph.diagnostics.filter((d) => d.severity === 'error').length} documents have errors and are left off the record;
    see <a href={resolve('/a/[acct]/d/[docket]/documents', { acct: data.org.slug, docket: data.workspace.slug })}>Documents</a>.
  </p>
{/if}

<div class="views" role="tablist" aria-label="Record views" bind:this={tabs}>
  {#each VIEW_TABS as tab (tab.view)}
    <button
      type="button"
      role="tab"
      aria-selected={browse.view === tab.view}
      onclick={() => update(switchView(browse, tab.view))}
      data-testid={`view-${tab.view}`}
    >
      {tab.label}
      {#if tab.count !== null}<span class="count">{tab.count}</span>{/if}
    </button>
  {/each}
  {#if ink}<span class="ink" aria-hidden="true" style="left: {ink.left}px; width: {ink.width}px"></span>{/if}
</div>

{#snippet pendingHistory()}
  <div class="nothing card" data-testid="history-pending">
    {#if failed}
      <p role="alert">Couldn't load the activity log and the documents' origins.</p>
      <button type="button" class="button small" onclick={() => (failed = false)}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
    {:else}
      <p class="muted small" role="status">Loading the activity log and the documents' origins…</p>
    {/if}
  </div>
{/snippet}

{#snippet showInNetwork()}
  <button type="button" class="button small" onclick={() => selected && showOnBoard(selected)}><Network size={14} aria-hidden="true" /> Show in the network</button>
{/snippet}

{#snippet typeChips()}
  <form
    class="query"
    role="search"
    aria-label="Query the record"
    onsubmit={(event) => {
      event.preventDefault()
      runQuery()
    }}
    data-testid="graph-query"
  >
    <label class="query-text">
      <Search size={14} aria-hidden="true" />
      <span class="visually-hidden">Query text</span>
      <input type="search" name="q" placeholder="Query records, then Enter · e.g. confidence:<0.5" title="Tokens: {TOKEN_HINTS.join(' · ')}" bind:value={draft} maxlength="200" />
    </label>
    <select class="tool" name="type" aria-label="Query type" value={browse.type} onchange={(event) => runQuery({ type: event.currentTarget.value })}>
      <option value="">Any type</option>
      {#each queryFacets.types as type (type.name)}<option value={type.name}>{type.name} · {type.count}</option>{/each}
    </select>
    {#if queryFacets.tags.length}
      <select class="tool" name="tag" aria-label="Query tag" value={browse.tag} onchange={(event) => runQuery({ tag: event.currentTarget.value })}>
        <option value="">Any tag</option>
        {#each queryFacets.tags as tag (tag.name)}<option value={tag.name}>{tag.name} · {tag.count}</option>{/each}
      </select>
    {/if}
  </form>
  {#if querying}
    <button type="button" class="tool" onclick={clearQuery} data-testid="graph-query-clear"><X size={14} aria-hidden="true" /> Clear</button>
  {/if}
  <span class="seg-tools" role="group" aria-label="Colour by">
    <button type="button" class="tool" aria-pressed={!byConfidence} onclick={() => update({ colour: 'type' })}>Colour by type</button>
    <button type="button" class="tool" aria-pressed={byConfidence} onclick={() => update({ colour: 'confidence' })}>By confidence</button>
  </span>
  <span class="type-chips" role="group" aria-label="Record types">
    {#each types as [type, count] (type)}
      <button
        type="button"
        class="tool type"
        aria-pressed={!hiddenTypes.has(type)}
        aria-label={type}
        title="{type} · {count}"
        onclick={() => (hiddenTypes.has(type) ? hiddenTypes.delete(type) : hiddenTypes.add(type))}
      >
        <i style="background: {colourOf(type)}" aria-hidden="true"></i>{typeCode(type)}
      </button>
    {/each}
  </span>
  <span class="more-filters">
    <button type="button" class="tool" aria-expanded={filtering} aria-controls="record-filters" onclick={() => (filtering = !filtering)}>
      <SlidersHorizontal size={14} aria-hidden="true" /> Filters
    </button>
    {#if filtering}
      <div class="filter-panel" id="record-filters">
        <Filters {graph} {hiddenTypes} {hiddenRels} bind:showUnresolved />
      </div>
    {/if}
  </span>
  <div class="board-row quick" role="group" aria-label="Quick queries">
    {#each QUICK_QUERIES as quick (quick.q)}
      <button type="button" class="tool qchip" aria-pressed={browse.q.trim() === quick.q} onclick={() => toggleQuery(quick.q)} title={quick.q}>{quick.label}</button>
    {/each}
  </div>
  {#if querying || scope.shown < scope.total}
    {@const matches = scope.matched?.length ?? 0}
    {@const linked = scope.total - matches}
    <div class="board-row"><div class="board-note" role="status" data-testid="board-note" data-shown={scope.shown} data-total={scope.total}>
      {#if searching}
        <span>Searching the docket…</span>
      {:else if querying && searchFailed === asked}
        <span>The search did not answer.</span>
        <button type="button" class="linkish" onclick={() => ((searchFailed = null), attempt++)}>Try again</button>
      {:else if scope.matched && parsed.tokens.length}
        <span data-testid="token-matches">
          <b>{matches} of {graph.entities.length}</b> {graph.entities.length === 1 ? 'record matches' : 'records match'} <code>{browse.q}</code>{linked > 0 ? `, with ${linked} linked ${linked === 1 ? 'record' : 'records'}` : ''}{scope.shown < scope.total ? `, showing ${scope.shown} of ${scope.total}` : ''}
        </span>
        <button type="button" class="linkish" onclick={clearQuery}>Clear</button>
      {:else if scope.matched}
        <span>
          {[
            matches === 0 ? 'Nothing matched' : `${matches} ${matches === 1 ? 'match' : 'matches'}`,
            linked > 0 ? ` and ${linked} linked ${linked === 1 ? 'record' : 'records'}` : '',
            scope.shown < scope.total ? `, showing ${scope.shown} of ${scope.total}` : '',
          ].join('')}
        </span>
      {:else}
        <span>Showing {scope.shown} of {scope.total} records, the most connected first</span>
      {/if}
      {#if !searching && scope.shown < scope.total}
        <button type="button" class="linkish" onclick={() => (limit = scope.shown + BOARD_LIMIT)}>Show {Math.min(BOARD_LIMIT, scope.total - scope.shown)} more</button>
        <button type="button" class="linkish" onclick={() => (limit = Infinity)}>Show all</button>
      {/if}
      {#if querying && answer?.for === asked}
        {#each answer.notes as note, at (at)}<span class="muted">{note}</span>{/each}
      {/if}
    </div></div>
  {/if}
{/snippet}

{#snippet legend()}
  <div class="legend" role="group" aria-label="Confidence bands" data-testid="legend">
    {#if byConfidence}
      {#each BANDS as band (band)}
        <button type="button" class="tool" aria-pressed={browse.q.trim() === `band:${band}`} onclick={() => toggleQuery(`band:${band}`)} data-band={band}>
          <i class="sw {BAND_STAMP[band]}" aria-hidden="true"></i>{BAND_LABELS[band]} <span class="muted">{bandRange(band, bands)}</span> <b>{bandCounts.get(band) ?? 0}</b>
        </button>
      {/each}
    {/if}
    {#if byConfidence || pendingCount > 0}
      <button type="button" class="tool" aria-pressed={browse.q.trim() === 'is:pending'} onclick={() => toggleQuery('is:pending')} data-band="pending">
        <i class="sw pend" aria-hidden="true"></i>Pending proposal <b>{pendingCount}</b>
      </button>
    {/if}
  </div>
{/snippet}

{#snippet tip(id: string)}
  {@const record = byId.get(id)}
  {#if record}
    {@const weight = weightOf(record)}
    {@const sources = record.trust?.sources ?? []}
    <div class="tip-head">{@render tipCode(record.type)}<b>{record.title}</b></div>
    {#if weight !== null}
      <div class="tip-score"><span class="big">{weight.toFixed(2)}</span>{#if record.trust?.band}<span class="stamp {BAND_STAMP[record.trust.band]}">{BAND_LABELS[record.trust.band]}</span>{/if}</div>
    {/if}
    {#if record.trust?.pending}
      <p class="tip-pend">Pending {record.trust.pending.proposal}: {record.trust.pending.score.toFixed(2)} of {record.trust.pending.threshold.toFixed(2)} to replace it.</p>
    {/if}
    {#if sources.length}
      <ul class="tip-why">
        {#each sources as line, at (at)}
          <li>
            <span><b>{line.instance ?? (line.source || 'No source given')}</b>{#if line.instance}<span class="dim">{` · ${line.source}`}</span>{/if}{#if line.self}<span class="dim">&nbsp;(no source cited)</span>{/if}<br /><span class="dim">{line.rules.length ? line.rules.map((rule) => `${rule.policy} ${rule.adjust ? (rule.value < 0 ? '−' : '+') + Math.abs(rule.value).toFixed(2) : rule.value.toFixed(2)}`).join(' · ') : 'no policy matches'}</span></span>
            <span class="mono">{line.score.toFixed(2)}</span>
          </li>
        {/each}
      </ul>
      {#if weight !== null}<p class="tip-f mono">1 − {sources.map((line) => `(1 − ${line.score.toFixed(2)})`).join('·')} = {weight.toFixed(2)}</p>{/if}
    {:else}
      <p class="dim">No evidence on file.</p>
    {/if}
    <p class="dim">Click to open the record.</p>
  {/if}
{/snippet}

{#snippet tipCode(type: string)}<span class="code" style="--c: {colourOf(type)}">{typeCode(type)}</span>{/snippet}

{#snippet fullScreen()}
  <button type="button" class="tool" aria-pressed={full} onclick={() => setFull(!full)} title={full ? 'Leave full screen (Esc)' : 'Fill the screen with the network'} data-testid="full-screen">
    {#if full}<Minimize2 size={14} aria-hidden="true" />{:else}<Maximize2 size={14} aria-hidden="true" />{/if} Full screen
  </button>
{/snippet}

{#if browse.view === 'facts'}
  <div role="tabpanel" aria-label="Findings of fact" class:beside-drawer={drawerOpen}>
    <FactsView
      {graph}
      {notes}
      filter={{ q: browse.q, kind: browse.kind, type: browse.type, source: browse.source, confidence: browse.confidence, flag: browse.flag, single: browse.single, about: browse.about }}
      {exhibits}
      {colourOf}
      open={browse.open}
      {selected}
      onfilter={filterChange}
      onopen={(open) => update({ open })}
      onselect={(id) => select(id)}
      onexhibit={openExhibit}
    />
  </div>
{:else if browse.view === 'timeline'}
  <div role="tabpanel" aria-label="Docket sheet">
    {#if history}
      <TimelineView
        {graph}
        activity={history.activity}
        show={browse.show}
        {selected}
        org={data.org.slug}
        {colourOf}
        exhibitLabel={labelOf}
        onshow={(show) => update({ show })}
        onselect={(id) => select(id)}
      />
    {:else}
      {@render pendingHistory()}
    {/if}
  </div>
{:else if browse.view === 'evidence'}
  <div role="tabpanel" aria-label="Exhibits">
    {#if history}
      <EvidenceView
        {graph}
        documents={history.documents}
        activity={history.activity}
        filter={{ q: browse.q, source: browse.source, bare: browse.bare }}
        doc={browse.doc}
        ws={{ acct: data.org.slug, docket: data.workspace.slug }}
        {colourOf}
        exhibitLabel={labelOf}
        onfilter={filterChange}
        onopen={(doc) => update({ doc })}
        onselect={(id) => select(id)}
      />
    {:else}
      {@render pendingHistory()}
    {/if}
  </div>
{:else}
  <div role="tabpanel" aria-label="Network" class:holds-full={full}>
    <div class="stage" class:full data-testid="network-stage">
      <CardGraph
        nodes={cards}
        links={cardLinks}
        {placed}
        {selected}
        onselect={(id) => select(id)}
        occluder={drawerOpen ? drawer : null}
        toolbar={typeChips}
        actions={fullScreen}
        find={false}
        fill={full}
        {byConfidence}
        {tip}
        legend={byConfidence || pendingCount > 0 ? legend : undefined}
        {emphasis}
        frame={`${asked}|${scope.shown}|${full}`}
        emptyHint={graph.entities.length === 0
          ? 'Import documents to see them here.'
          : scope.matched?.length === 0
            ? 'Nothing matched: try other words, or clear the query.'
            : 'Switch record types on above.'}
      />
    </div>
    <section class="directory" aria-labelledby="directory-title">
      <h2 id="directory-title">Index of records</h2>
      {#each types as [type] (type)}
        <div class="card">
          <h3 class="label">{type.replaceAll('_', ' ')}</h3>
          <ul>
            {#each graph.entities.filter((item) => item.type === type) as record (record.id)}
              <li>
                <button type="button" class="linkish" onclick={() => select(record.id)}>{record.title}</button>
                <span class="mono muted">{record.id}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </section>
  </div>
{/if}

{#if drawerOpen}
  <!-- On a phone the sheet covers the lower screen: off the network, a scrim closes it. -->
  {#if browse.view !== 'graph'}
    <button type="button" class="scrim" aria-label="Close the case file" tabindex="-1" onclick={close}></button>
  {/if}
  <aside class="drawer" class:over-full={full} bind:this={drawer} aria-label={capturing ? 'Capture' : `Case file: ${entity?.title ?? selected}`} data-testid="record-drawer">
    {#if capturing}
      <div class="capture">
        <CapturePanel
          vocabulary={data.capture.vocabulary}
          entities={graph.entities.map(({ id, type, title }) => ({ id, type, title }))}
          edges={graph.edges.map(({ source, rel, target }) => ({ source, rel, target }))}
          {selected}
          csrf={data.csrf}
          result={form?.capture ?? null}
          onclose={() => (capturing = false)}
        />
      </div>
    {:else if selected}
      <CaseFile
        {graph}
        {entity}
        id={selected}
        {colourOf}
        {exhibits}
        entries={entriesAbout}
        findings={findingsAbout}
        onfinding={openFinding}
        onfindings={openFindings}
        onselect={(id) => select(id)}
        onclose={close}
        onexhibit={openExhibit}
        actions={browse.view === 'graph' ? undefined : showInNetwork}
        canEditSchema={data.canEditSchema}
      />
    {/if}
  </aside>
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
  }
  h1 {
    margin: 0;
  }
  .lede {
    margin: 0.35rem 0 0;
    font-size: 14px;
  }
  .head-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .index {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .ok {
    color: var(--ok);
  }
  .behind {
    color: var(--warn);
  }
  .small {
    font-size: 0.8125rem;
  }
  .alert,
  .flash {
    margin: 0.9rem 0 0;
  }

  /* The record's views: tabs with counts, and an underline that slides between them. */
  .views {
    position: relative;
    display: flex;
    gap: 2px;
    margin: 1.1rem 0 18px;
    overflow-x: auto;
    border-bottom: 1px solid var(--rule);
    scrollbar-width: none;
  }
  .views::-webkit-scrollbar {
    display: none;
  }
  .views button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 7px;
    height: 40px;
    padding: 0 12px;
    border: 0;
    background: none;
    color: var(--mute);
    font: inherit;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }
  .views button:hover,
  .views button[aria-selected='true'] {
    color: var(--ink);
  }
  .views .count {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--sunk);
    color: var(--mute);
    font: 500 10.5px var(--font-mono);
  }
  .views .ink {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: var(--ink);
    transition:
      left 0.3s var(--ease-io),
      width 0.3s var(--ease-io);
  }

  /* Full screen: the network over the whole window, the case file still beside it. */
  .stage.full {
    position: fixed;
    inset: 0;
    z-index: 48;
    background: var(--bg);
  }
  /* The section's rise leaves a transform behind, which would hold a fixed stage inside the panel. */
  [role='tabpanel'].holds-full {
    transform: none;
    animation: none;
  }
  :global(html:has(.stage.full)) {
    overflow: hidden;
  }
  .drawer.over-full {
    top: 14px;
  }

  /* The network's query: text, a type and a tag, in the canvas's top row. */
  .query {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .query-text {
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
  .query-text:focus-within {
    border-color: var(--ink-2);
  }
  .query-text input {
    width: 190px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: 12.5px;
  }
  .query select.tool {
    max-width: 11rem;
    appearance: auto;
  }
  /* Its own line under the controls; only the note itself takes the pointer, not the canvas beside it. */
  .stage .board-row {
    flex-basis: 100%;
    pointer-events: none;
  }
  .board-note {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    max-width: 100%;
    pointer-events: auto;
    padding: 5px 10px;
    border: 1px solid var(--rule);
    border-radius: 7px;
    background: color-mix(in oklab, var(--paper) 92%, transparent);
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .board-note .linkish {
    font-weight: 500;
  }
  .board-note code {
    font: 500 11.5px var(--font-mono);
  }
  .stage .board-row.quick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .board-row.quick .qchip {
    pointer-events: auto;
    height: 26px;
    font-size: 12px;
  }
  .seg-tools {
    display: inline-flex;
    gap: 2px;
  }

  /* The key to the bands, in the canvas's bottom corner: each entry filters. */
  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }
  .legend .tool {
    height: 28px;
    font-size: 12px;
  }
  .legend b {
    font: 600 11.5px var(--font-mono);
  }
  .sw {
    width: 10px;
    height: 10px;
    border: 1.5px solid currentColor;
    border-radius: 3px;
  }
  .sw.ok {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .sw.warn {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .sw.red {
    color: var(--signal);
    border-style: dashed;
    background: var(--signal-soft);
  }
  .sw.pend {
    color: var(--warn);
    border-style: dashed;
    background: repeating-linear-gradient(135deg, var(--warn-soft) 0 2px, transparent 2px 4px);
  }

  /* The hover card's contents: CardGraph places it. */
  .tip-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
  }
  .tip-score {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0 6px;
  }
  .tip-score .big {
    font: 400 34px/1 var(--font-serif);
  }
  .tip-pend {
    margin: 0 0 6px;
    color: var(--warn-soft);
  }
  .tip-why {
    display: grid;
    gap: 6px;
    margin: 6px 0;
    padding: 0;
    list-style: none;
  }
  .tip-why li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    line-height: 1.35;
  }
  .tip-f {
    margin: 6px 0;
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
  .dim {
    opacity: 0.68;
  }
  p.dim {
    margin: 4px 0 0;
  }

  /* The network's own controls, in the canvas's top row. */
  .type-chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .type-chips :global(.tool.type) {
    padding: 0 8px;
    font: 600 11px var(--font-mono);
    letter-spacing: 0.04em;
  }
  .type-chips i {
    width: 7px;
    height: 7px;
    border-radius: 2px;
  }
  .type-chips [aria-pressed='false'] i {
    opacity: 0.35;
  }
  .more-filters {
    position: relative;
  }
  .filter-panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 5;
    width: 17rem;
    max-height: 22rem;
    overflow-y: auto;
    border-radius: var(--r-card);
    background: var(--paper);
    box-shadow: var(--shadow-2);
  }

  /* An index of records: the network as a list, for phones and screen readers. */
  .directory {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .directory h2 {
    margin: 0 0 12px;
  }
  .directory .card {
    margin-bottom: 10px;
    padding: 12px 16px;
  }
  .directory h3 {
    margin: 0 0 6px;
  }
  .directory ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .directory li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 44px;
    border-top: 1px solid var(--rule);
  }
  .directory li:first-child {
    border-top: 0;
  }
  .directory .mono {
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: right;
  }
  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--rule-2);
    text-underline-offset: 3px;
    cursor: pointer;
  }

  /* The record drawer: a case file at the side, a bottom sheet on a phone. */
  .drawer {
    position: fixed;
    top: 64px;
    right: 14px;
    bottom: 14px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    width: min(430px, calc(100vw - 28px));
    overflow: hidden;
    border-radius: 14px;
    background: var(--paper);
    box-shadow: var(--shadow-2);
    animation: drawer-in 0.38s var(--ease-out);
  }
  @keyframes drawer-in {
    from {
      transform: translateX(28px);
      opacity: 0;
    }
  }
  .capture {
    min-height: 0;
    overflow-y: auto;
  }
  .scrim {
    display: none;
  }
  /* The notes stay readable beside an open case file. */
  .beside-drawer {
    padding-right: min(444px, calc(100vw - 28px));
  }

  .nothing {
    padding: 1.25rem;
  }
  .nothing p {
    margin: 0 0 0.5rem;
  }
  @media (max-width: 900px) {
    .beside-drawer {
      padding-right: 0;
    }
    .directory {
      position: static;
      width: auto;
      height: auto;
      margin-top: 20px;
      overflow: visible;
      clip: auto;
      white-space: normal;
    }
    /* A phone's canvas row: the query and Filters; the type chips live in Filters. */
    .type-chips {
      display: none;
    }
    .query-text {
      height: 40px;
    }
    .query-text input {
      width: 110px;
    }
    .query select.tool {
      max-width: 7.5rem;
    }
    .drawer {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      max-height: 62dvh;
      border-radius: 18px 18px 0 0;
      animation-name: sheet-up;
    }
    .drawer::before {
      content: '';
      position: absolute;
      top: 7px;
      left: 50%;
      width: 40px;
      height: 4px;
      margin-left: -20px;
      border-radius: 2px;
      background: var(--rule-2);
    }
    @keyframes sheet-up {
      from {
        transform: translateY(40px);
        opacity: 0;
      }
    }
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 46;
      display: block;
      border: 0;
      background: rgb(10 10 8 / 0.38);
      animation: fade 0.2s both;
    }
  }
</style>
