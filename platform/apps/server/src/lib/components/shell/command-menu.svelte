<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { FileText, FolderOpen, LoaderCircle, MessageSquareText, Search, Tag, Waypoints } from '@lucide/svelte'
  import { tick } from 'svelte'

  import { handoff } from '$lib/ask/handoff.svelte'
  import { SHEET_KINDS } from '$lib/graph/browse'
  import type { ResultGroups } from '$lib/ask/groups'
  import { colourIn, type SearchHit, type TypeSlots } from '$lib/ask/model'
  import { typeCode } from '$lib/docket'
  import { exhibitLabel } from '$lib/graph/sheet'

  /**
   * The command menu (⌘K): jump to a page, or find a record, note, memory
   * match, exhibit or docket entry by name or ID - in the open docket, or
   * across the casebook outside one - with the same direct search as Ask's.
   * Its last rows search everything for the words, or ask them.
   */
  interface Props {
    open: boolean
    org: { slug: string; name: string }
    /** The open docket, when there is one: the search keeps to it. */
    workspace: { slug: string; name: string } | null
    dockets: { slug: string; name: string; docketNo: string }[]
    canAdminister: boolean
    /** Whoever manages system accounts somewhere. */
    canManageAccess?: boolean
  }

  let { open = $bindable(), org, workspace, dockets, canAdminister, canManageAccess = false }: Props = $props()

  /** Results of each kind listed. */
  const PER_GROUP = 3
  /** The shortest query searched, and how long typing must pause first, in milliseconds. */
  const SEARCH_FROM = 3
  const PAUSE = 400

  type Item = { group: string; label: string; meta: string; href?: string; run?: () => void; code?: string; colour?: string; icon?: typeof Search }

  let query = $state('')
  let index = $state(0)
  let input = $state<HTMLInputElement>()
  let found = $state<{ records: SearchHit[]; groups: ResultGroups; slots: TypeSlots } | null>(null)
  let loading = $state(false)
  let problem = $state<string | null>(null)

  const docketNos = $derived(new Map(dockets.map((docket) => [docket.slug, docket.docketNo])))
  const graph = (ws: string) => resolve('/a/[org]/d/[ws]/graph', { org: org.slug, ws })
  const focus = (id: string) => `focus=${encodeURIComponent(id)}`

  const pages = $derived.by((): Item[] => {
    const list: Item[] = [
      { group: 'Pages', label: 'Home', meta: '', href: resolve('/a/[org]', { org: org.slug }), icon: FolderOpen },
      {
        group: 'Pages',
        label: 'Chat',
        meta: '/',
        href: `${resolve('/a/[org]/ask', { org: org.slug })}${workspace ? `?ws=${encodeURIComponent(workspace.slug)}` : ''}`,
        icon: MessageSquareText,
      },
    ]
    if (workspace) {
      const ws = workspace.slug
      list.push(
        { group: 'Pages', label: `${workspace.name} overview`, meta: docketNos.get(ws) ?? '', href: resolve('/a/[org]/d/[ws]/overview', { org: org.slug, ws }) },
        { group: 'Pages', label: 'Record · network', meta: '', href: graph(ws) },
        { group: 'Pages', label: 'Record · facts', meta: '', href: `${graph(ws)}?view=facts` },
        { group: 'Pages', label: 'Record · docket sheet', meta: '', href: `${graph(ws)}?view=timeline` },
        { group: 'Pages', label: 'Record · exhibits', meta: '', href: `${graph(ws)}?view=evidence` },
        { group: 'Pages', label: `Chat · ${workspace.name} only`, meta: '', href: resolve('/a/[org]/d/[ws]/ask', { org: org.slug, ws }), icon: MessageSquareText },
        { group: 'Pages', label: 'Documents', meta: '', href: resolve('/a/[org]/d/[ws]/documents', { org: org.slug, ws }) },
        { group: 'Pages', label: 'Schema', meta: '', href: resolve('/a/[org]/d/[ws]/ontology', { org: org.slug, ws }) },
        { group: 'Pages', label: 'Activity', meta: '', href: resolve('/a/[org]/d/[ws]/activity', { org: org.slug, ws }) },
        { group: 'Pages', label: 'Docket settings', meta: '', href: resolve('/a/[org]/d/[ws]/settings', { org: org.slug, ws }) },
      )
    }
    list.push(
      { group: 'Pages', label: 'Users', meta: '', href: resolve('/a/[org]/members', { org: org.slug }) },
      { group: 'Pages', label: 'Your tokens & connections', meta: '', href: resolve('/a/[org]/tokens', { org: org.slug }) },
      { group: 'Pages', label: 'Audit log', meta: '', href: resolve('/a/[org]/audit', { org: org.slug }) },
    )
    if (canAdminister) list.push({ group: 'Pages', label: 'Account settings', meta: '', href: resolve('/a/[org]/settings', { org: org.slug }) })
    if (canManageAccess) list.push({ group: 'Pages', label: 'System accounts', meta: '', href: resolve('/a/[org]/settings/system-accounts', { org: org.slug }) })
    for (const docket of dockets) {
      if (docket.slug !== workspace?.slug) {
        list.push({ group: 'Dockets', label: docket.name, meta: docket.docketNo, href: resolve('/a/[org]/d/[ws]/overview', { org: org.slug, ws: docket.slug }), icon: FolderOpen })
      }
    }
    return list
  })

  const wanted = $derived(query.trim())
  const words = $derived(wanted.toLowerCase().split(/\s+/).filter(Boolean))
  const fits = (item: Item) => words.every((word) => `${item.label} ${item.meta}`.toLowerCase().includes(word))

  const items = $derived.by((): Item[] => {
    if (!wanted) return pages.filter((item) => item.group === 'Pages').slice(0, workspace ? 7 : 5)
    const listed: Item[] = [...pages.filter(fits).slice(0, PER_GROUP + 2)]
    const ws = (slug: string) => (workspace ? '' : ` · ${dockets.find((docket) => docket.slug === slug)?.name ?? slug}`)
    if (found) {
      for (const hit of found.records.slice(0, PER_GROUP)) {
        listed.push({ group: 'Records', label: hit.title, meta: `${hit.id}${ws(hit.workspace.slug)}`, href: `${graph(hit.workspace.slug)}?${focus(hit.id)}`, code: typeCode(hit.type), colour: colourIn(found.slots, hit.workspace.slug, hit.type) })
      }
      for (const note of found.groups.notes.slice(0, PER_GROUP)) {
        listed.push({ group: 'Notes', label: note.title, meta: `${note.no}${ws(note.workspace.slug)}`, href: `${graph(note.workspace.slug)}?view=facts&open=${note.no}`, icon: FileText })
      }
      for (const memory of found.groups.memory.slice(0, PER_GROUP)) {
        listed.push({ group: 'Memory', label: memory.text, meta: `${memory.id}${ws(memory.workspace.slug)}`, href: `${graph(memory.workspace.slug)}?${focus(memory.id)}`, icon: Waypoints })
      }
      for (const exhibit of found.groups.exhibits.slice(0, PER_GROUP)) {
        listed.push({
          group: 'Exhibits',
          label: exhibit.text,
          meta: `${exhibitLabel(docketNos.get(exhibit.workspace.slug) ?? '', exhibit.no)}${ws(exhibit.workspace.slug)}`,
          href: `${graph(exhibit.workspace.slug)}?view=evidence&doc=${encodeURIComponent(exhibit.path)}`,
          icon: Tag,
        })
      }
      for (const entry of found.groups.entries.slice(0, PER_GROUP)) {
        listed.push({
          group: 'Docket entries',
          label: `${SHEET_KINDS[entry.kind]} — ${entry.text}`,
          meta: `#${String(entry.no).padStart(3, '0')}${ws(entry.workspace.slug)}`,
          href: `${graph(entry.workspace.slug)}?view=timeline${entry.entity ? `&${focus(entry.entity)}` : ''}`,
          icon: FileText,
        })
      }
    }
    const ask = resolve('/a/[org]/ask', { org: org.slug })
    const scope = workspace ? `&ws=${encodeURIComponent(workspace.slug)}` : ''
    listed.push(
      { group: 'Chat', label: `Search everything for “${wanted}”`, meta: 'no AI', href: `${ask}?mode=search&q=${encodeURIComponent(wanted)}${scope}`, icon: Search },
      {
        group: 'Chat',
        label: `Ask: “${wanted}”`,
        meta: '↵',
        run: async () => {
          // eslint-disable-next-line svelte/no-navigation-without-resolve -- Ask's resolved path, with the open docket chosen
          await goto(scope ? `${ask}?${scope.slice(1)}` : ask)
          handoff.question = wanted
        },
        icon: MessageSquareText,
      },
    )
    return listed
  })

  // The record's own search, a moment after typing stops; a newer query cancels the older.
  $effect(() => {
    const q = wanted
    found = null
    problem = null
    if (!open || q.length < SEARCH_FROM) {
      loading = false
      return
    }
    loading = true
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const scope = workspace ? `&ws=${encodeURIComponent(workspace.slug)}` : ''
      // `accounts.search` (@docket/api): the same on a server-rendered page and in the web UI.
      fetch(`/api/v1/accounts/${encodeURIComponent(org.slug)}/search?q=${encodeURIComponent(q)}${scope}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`The search answered ${response.status}.`)
          found = await response.json()
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) problem = cause instanceof Error ? cause.message : String(cause)
        })
        .finally(() => {
          if (!controller.signal.aborted) loading = false
        })
    }, PAUSE)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  })

  $effect(() => {
    void items.length
    index = Math.min(index, Math.max(0, items.length - 1))
  })

  // Opening starts afresh, with the box ready to type in.
  $effect(() => {
    if (!open) return
    query = ''
    index = 0
    void tick().then(() => input?.focus())
  })

  async function run(item: Item | undefined) {
    if (!item) return
    open = false
    if (item.run) item.run()
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- every item's href is a resolved path of the casebook's
    else if (item.href) await goto(item.href)
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      index = Math.min(index + 1, items.length - 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      index = Math.max(index - 1, 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void run(items[index])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      open = false
    }
  }

  $effect(() => {
    void index
    void tick().then(() => document.getElementById(`cmdk-${index}`)?.scrollIntoView({ block: 'nearest' }))
  })
</script>

{#if open}
  <div class="cmdk" role="presentation" onclick={(event) => event.target === event.currentTarget && (open = false)}>
    <div class="box" role="dialog" aria-modal="true" aria-label="Search or jump to">
      <div class="in">
        {#if loading}<LoaderCircle size={17} class="spin" aria-hidden="true" />{:else}<Search size={17} aria-hidden="true" />{/if}
        <input
          bind:this={input}
          bind:value={query}
          onkeydown={onKey}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items.length ? `cmdk-${index}` : undefined}
          aria-autocomplete="list"
          placeholder={workspace ? `Search ${workspace.name}, or jump to…` : 'Search the account, or jump to…'}
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <ul class="list" id="cmdk-list" role="listbox" aria-label="Results" data-testid="command-results">
        {#each items as item, at (`${item.group}:${item.label}:${item.meta}:${at}`)}
          {#if at === 0 || items[at - 1]?.group !== item.group}
            <li class="grp label" role="presentation">{item.group}</li>
          {/if}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="cmdk-{at}"
            role="option"
            aria-selected={at === index}
            data-group={item.group}
            onclick={() => run(item)}
            onmousemove={() => (index = at)}
          >
            {#if item.code}<span class="code" style="--c: {item.colour}">{item.code}</span>{:else if item.icon}<item.icon
                size={16}
                aria-hidden="true"
              />{:else}<span></span>{/if}
            <span class="text">{item.label}</span>
            <span class="mono muted meta">{item.meta}</span>
          </li>
        {/each}
        {#if problem}<li class="note" role="presentation">{problem}</li>{/if}
      </ul>
      <div class="foot" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .cmdk {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: start center;
    padding-top: 14vh;
    background: rgb(10 10 8 / 0.35);
    animation: fade 0.15s both;
  }
  .box {
    width: min(620px, calc(100vw - 24px));
    overflow: hidden;
    border-radius: 14px;
    background: var(--paper);
    box-shadow: var(--shadow-2);
    animation: rise 0.22s var(--ease-out) both;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    border-bottom: 1px solid var(--rule);
    color: var(--mute);
  }
  .in :global(.spin) {
    animation: spin 0.9s linear infinite;
  }
  .in input {
    flex: 1;
    min-width: 0;
    height: 52px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    box-shadow: none;
    font-size: 16px;
    color: var(--ink);
  }
  .list {
    max-height: 50vh;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    list-style: none;
  }
  .list li[role='option'] {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 9px 10px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
  }
  .list li[aria-selected='true'] {
    background: var(--sunk);
    box-shadow: inset 2px 0 0 var(--signal);
  }
  .list li :global(svg) {
    justify-self: center;
    color: var(--ink-2);
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 12px;
    white-space: nowrap;
  }
  .grp {
    display: block;
    padding: 8px 10px 4px;
  }
  .note {
    padding: 8px 10px;
    font-size: 13px;
    color: var(--signal);
  }
  .foot {
    display: flex;
    gap: 14px;
    padding: 9px 14px;
    border-top: 1px solid var(--rule);
    font-size: 12px;
    color: var(--mute);
  }
  .foot kbd {
    margin-right: 3px;
  }
  @media (max-width: 600px) {
    .cmdk {
      padding-top: 8vh;
    }
    .meta {
      display: none;
    }
    .list li[role='option'] {
      grid-template-columns: 30px minmax(0, 1fr);
    }
  }
</style>
