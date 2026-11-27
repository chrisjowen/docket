<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import {
    BellRing,
    ChevronsUpDown,
    FolderOpen,
    KeyRound,
    Gauge,
    LayoutGrid,
    LayoutTemplate,
    ListChecks,
    LogOut,
    Menu,
    MessageSquareText,
    Moon,
    Network,
    Plus,
    ScrollText,
    Search,
    Settings,
    Sun,
    Users,
    X,
  } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  import Avatar from '$lib/components/avatar.svelte'
  import Csrf from '$lib/components/csrf.svelte'
  import { applyTheme, type Theme } from '$lib/theme'

  import CommandMenu from './command-menu.svelte'
  import { crumbsFor } from './crumbs'
  import DocketMark from './docket-mark.svelte'
  import DocketWordmark from './docket-wordmark.svelte'

  interface Props {
    user: { login: string; name: string | null; allowlisted: boolean; platformAdmin: boolean }
    orgs: { slug: string; name: string; role: string }[]
    csrf: string | null
    theme: Theme
    children: Snippet
  }

  /** What an org's layout adds to the page's data, when the page is inside one. */
  interface OrgData {
    org?: { slug: string; name: string }
    role?: string
    permissions?: Record<string, boolean>
    owner?: boolean
    accountAdmin?: boolean
    managesAccess?: boolean
    managesSystemAccounts?: boolean
    dockets?: { slug: string; name: string; spaceId: string; docketNo: string; open: boolean }[]
    /** The account's spaces the member sees, General first; `create`: they may add a docket there. */
    spaces?: { id: string; slug: string; name: string; general: boolean; create: boolean }[]
    /** May make a space (Spaces +). */
    createsSpaces?: boolean
    ai?: { spentUsd: number; capUsd: number; fraction: number; warned: boolean }
    /** For the account's owners: system account tokens about to expire, or just expired. */
    tokenNotices?: { expiring: number; expired: number }
    workspace?: { slug: string; name: string }
    /** On a space's pages: the space. */
    space?: { slug: string; name: string }
  }

  let { user, orgs, csrf, theme: initialTheme, children }: Props = $props()

  const data = $derived(page.data as OrgData)
  const org = $derived(data.org ?? null)
  const workspace = $derived(org ? (data.workspace ?? null) : null)
  const docketNo = $derived(workspace ? (data.dockets?.find((entry) => entry.slug === workspace.slug)?.docketNo ?? null) : null)
  const crumbs = $derived(crumbsFor({ routeId: page.route.id, pathname: page.url.pathname, org, workspace, space: org ? (data.space ?? null) : null }))
  const orgPath = (path: '' | '/ask' | '/members' | '/tokens' | '/audit' | '/templates' | '/settings') => (org ? `/o/${org.slug}${path}` : '/')
  const current = (href: string) => (page.url.pathname === href ? 'page' : undefined)
  /** Inside a docket, Ask opens on it. */
  const askScope = $derived(workspace ? `?ws=${encodeURIComponent(workspace.slug)}` : '')
  /** The space the page is in: a space's own pages, or the open docket's. */
  const openSpace = $derived(
    page.params.space ?? (workspace ? data.spaces?.find((space) => space.id === data.dockets?.find((entry) => entry.slug === workspace.slug)?.spaceId)?.slug : undefined),
  )

  // The theme: the server rendered <html data-theme> from the cookie; the toggle flips both.
  let theme = $derived<Theme>(initialTheme)
  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(theme)
  }

  // On a phone the sidebar is a drawer, opened from the tab bar's Menu.
  let drawer = $state(false)
  afterNavigate(() => {
    drawer = false
  })

  // The command menu: ⌘K (Ctrl+K) from anywhere in a casebook, or the sidebar's search field.
  let menu = $state(false)
  afterNavigate(() => {
    menu = false
  })

  /** ⌘K opens the command menu; `/` jumps to Ask from anywhere but a text field. */
  function onKeydown(event: KeyboardEvent) {
    if (org && (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      menu = !menu
      return
    }
    if (event.key === 'Escape' && drawer) {
      drawer = false
      return
    }
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || !org || menu) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    event.preventDefault()
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- Ask's resolved path, on the open docket
    void goto(`${resolve('/o/[org]/ask', { org: org.slug })}${askScope}`)
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet waitlist()}
  {#if user.platformAdmin}
    <li>
      <a href={resolve('/admin/waitlist')} aria-current={current('/admin/waitlist')}><ListChecks size={17} aria-hidden="true" /> Waitlist</a>
    </li>
  {/if}
{/snippet}

<a class="skip" href="#content">Skip to content</a>
<div class="shell" class:drawer-open={drawer}>
  <aside class="side" aria-label="Docket Cloud">
    <details class="brand">
      <summary>
        <DocketMark />
        <span class="brand-text">
          <DocketWordmark height={17} />
          {#if org}<small>{org.name} · {data.role ?? ''}</small>{/if}
        </span>
        <ChevronsUpDown size={14} aria-hidden="true" class="chev" />
        <span class="visually-hidden">Switch casebook</span>
      </summary>
      <div class="menu" role="group" aria-label="Your casebooks">
        <span class="label">Your casebooks</span>
        {#each orgs as entry (entry.slug)}
          <a href={resolve('/o/[org]', { org: entry.slug })} aria-current={entry.slug === org?.slug ? 'page' : undefined}>
            <span class="org-mark" aria-hidden="true">{entry.name.slice(0, 2).toUpperCase()}</span>
            <span class="grow">{entry.name}</span>
            <span class="badge">{entry.role}</span>
          </a>
        {:else}
          <p class="muted empty">No organisations yet.</p>
        {/each}
        {#if user.allowlisted}
          <a href={resolve('/orgs/new')} class="new"><Plus size={14} aria-hidden="true" /> New organisation</a>
        {/if}
      </div>
    </details>

    {#if org}
      <button type="button" class="jump" onclick={() => (menu = true)} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K">
        <Search size={15} aria-hidden="true" />
        <span>Search or jump to…</span>
        <kbd aria-hidden="true">⌘K</kbd>
      </button>
    {/if}

    <nav class="nav" aria-label="Sidebar">
      {#if org}
        <ul class="primary" aria-label="Casebook">
          <li>
            <a href={resolve('/o/[org]', { org: org.slug })} aria-current={current(orgPath(''))}>
              <FolderOpen size={17} aria-hidden="true" /> Casebook
            </a>
          </li>
          <li>
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Ask's resolved path, on the open docket -->
            <a href="{resolve('/o/[org]/ask', { org: org.slug })}{askScope}" aria-current={current(orgPath('/ask'))}>
              <MessageSquareText size={17} aria-hidden="true" /> Ask
            </a>
          </li>
          <li>
            <a href={resolve('/o/[org]/members', { org: org.slug })} aria-current={current(orgPath('/members'))}>
              <Users size={17} aria-hidden="true" /> Users
            </a>
          </li>
          <li>
            <a href={resolve('/o/[org]/tokens', { org: org.slug })} aria-current={current(orgPath('/tokens'))}>
              <KeyRound size={17} aria-hidden="true" /> Tokens & connections
            </a>
          </li>
          <li>
            <a href={resolve('/o/[org]/audit', { org: org.slug })} aria-current={current(orgPath('/audit'))}>
              <ScrollText size={17} aria-hidden="true" /> Audit log
            </a>
          </li>
          {#if data.permissions?.settings}
            <li>
              <a href={resolve('/o/[org]/templates', { org: org.slug })} aria-current={current(orgPath('/templates'))}>
                <LayoutTemplate size={17} aria-hidden="true" /> Templates
              </a>
            </li>
          {/if}
          {#if data.owner || data.accountAdmin || data.managesSystemAccounts}
            <li>
              <a href={resolve('/o/[org]/settings', { org: org.slug })} aria-current={page.url.pathname.startsWith(orgPath('/settings')) ? 'page' : undefined}>
                <Settings size={17} aria-hidden="true" /> Settings
              </a>
            </li>
          {/if}
          {@render waitlist()}
        </ul>

        <div class="section spaces-head">
          <span class="label" id="spaces-label">Spaces</span>
          {#if data.createsSpaces}
            <a
              class="add"
              href={resolve('/o/[org]/spaces/new', { org: org.slug })}
              aria-label="New space"
              title="New space"
              data-testid="new-space"
              aria-current={current(`/o/${org.slug}/spaces/new`)}><Plus size={15} aria-hidden="true" /></a
            >
          {/if}
        </div>
        <ul class="spaces" aria-labelledby="spaces-label">
          {#each data.spaces ?? [] as space (space.id)}
            {@const inSpace = (data.dockets ?? []).filter((entry) => entry.spaceId === space.id)}
            <li class="space" data-space={space.slug}>
              <div class="space-row" class:here={openSpace === space.slug}>
                <a
                  class="space-name"
                  href={resolve('/o/[org]/s/[space]', { org: org.slug, space: space.slug })}
                  aria-current={page.url.pathname === `/o/${org.slug}/s/${space.slug}` ? 'page' : undefined}
                >
                  <span class="space-mark" aria-hidden="true">{space.name.slice(0, 1).toUpperCase()}</span>
                  <span class="docket-name">{space.name}</span>
                </a>
                {#if space.create}
                  <a
                    class="add"
                    href={resolve('/o/[org]/s/[space]/new', { org: org.slug, space: space.slug })}
                    aria-label="New docket in {space.name}"
                    title="New docket in {space.name}"
                    data-testid="new-docket-in-{space.slug}"
                    aria-current={current(`/o/${org.slug}/s/${space.slug}/new`)}><Plus size={15} aria-hidden="true" /></a
                  >
                {/if}
              </div>
              <ul class="dockets" aria-label="Dockets in {space.name}">
                {#each inSpace as entry (entry.slug)}
                  <li>
                    {#if entry.open}
                      <a
                        href={resolve('/o/[org]/w/[ws]/overview', { org: org.slug, ws: entry.slug })}
                        aria-current={workspace?.slug === entry.slug ? 'page' : undefined}
                      >
                        <span class="sdot" aria-hidden="true"></span>
                        <span class="docket-name">{entry.name}</span>
                        <span class="mono no">{entry.docketNo}</span>
                      </a>
                    {:else}
                      <span class="closed" title="You have no access to this docket.">
                        <span class="docket-name">{entry.name}</span>
                        <span class="mono no">No access</span>
                      </span>
                    {/if}
                  </li>
                {:else}
                  <li class="muted none">No dockets yet.</li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {:else}
        <ul class="primary" aria-label="Casebooks">
          <li>
            <a href={resolve('/')} aria-current={current('/')}><LayoutGrid size={17} aria-hidden="true" /> Home</a>
          </li>
          {#each orgs as entry (entry.slug)}
            <li>
              <a href={resolve('/o/[org]', { org: entry.slug })}><FolderOpen size={17} aria-hidden="true" /> {entry.name}</a>
            </li>
          {/each}
          {@render waitlist()}
        </ul>
      {/if}
    </nav>

    <div class="foot">
      {#if org && data.tokenNotices && data.tokenNotices.expiring + data.tokenNotices.expired > 0}
        <a class="notice" data-testid="token-notice" href={resolve('/o/[org]/settings/system-accounts', { org: org.slug })}>
          <BellRing size={14} aria-hidden="true" />
          <span>
            {#if data.tokenNotices.expired}{data.tokenNotices.expired} system account {data.tokenNotices.expired === 1 ? 'token has' : 'tokens have'} expired{data.tokenNotices.expiring ? '; ' : '.'}{/if}
            {#if data.tokenNotices.expiring}{data.tokenNotices.expiring} {data.tokenNotices.expired ? '' : 'system account '}{data.tokenNotices.expiring === 1 ? 'token expires' : 'tokens expire'} within two weeks.{/if}
          </span>
        </a>
      {/if}
      {#if org && data.ai}
        <div class="ai" data-testid="ai-usage" title="AI spend this month: model-written Cypher, answers and extraction. Search never uses it.">
          <span class="label"><Gauge size={13} aria-hidden="true" /> AI this month</span>
          <span class="meter" aria-hidden="true"
            ><span class:warn={data.ai.fraction >= 0.8} style="width: {Math.min(100, data.ai.fraction * 100)}%"></span></span
          >
          <span class="figures mono">${data.ai.spentUsd.toFixed(2)} of ${data.ai.capUsd.toFixed(2)}</span>
          {#if data.ai.fraction >= 1}
            <span class="note"
              >Budget reached: search still works{data.owner ? '; raise the cap in Settings' : '; ask an owner to raise the cap'}.</span
            >
          {:else if data.ai.warned && data.owner}
            <span class="note">Over 80% of this month's cap.</span>
          {/if}
        </div>
      {/if}
      <div class="me">
        <Avatar login={user.login} name={user.name} />
        <span class="who">
          <b>{user.name ?? user.login}</b>
          <small class="mono">@{user.login}</small>
        </span>
        <button
          type="button"
          class="icon-btn"
          onclick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {#if theme === 'dark'}<Sun size={16} aria-hidden="true" />{:else}<Moon size={16} aria-hidden="true" />{/if}
        </button>
        <form method="POST" action="/signout">
          <Csrf token={csrf} />
          <button class="icon-btn" type="submit" aria-label="Sign out" title="Sign out"><LogOut size={16} aria-hidden="true" /></button>
        </form>
      </div>
    </div>
  </aside>
  <button type="button" class="scrim" aria-label="Close the menu" tabindex="-1" onclick={() => (drawer = false)}></button>

  <div class="main-col">
    <header class="crumbs">
      <nav aria-label="Breadcrumb">
        <ol>
          {#each crumbs as crumb, index (index)}
            <li>
              {#if index > 0}<span class="sep" aria-hidden="true">/</span>{/if}
              {#if crumb.href}
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the casebook's and docket's own paths, from crumbsFor -->
                <a href={crumb.href}>{crumb.label}</a>
              {:else}
                <b aria-current="page">{crumb.label}</b>
              {/if}
            </li>
          {/each}
        </ol>
      </nav>
      <span class="grow"></span>
      {#if docketNo}<span class="docket-no hide-sm" data-testid="crumb-docket-no">{docketNo}</span>{/if}
      {#if org}
        <a class="button primary small ask" href="{resolve('/o/[org]/ask', { org: org.slug })}{askScope}">
          <MessageSquareText size={15} aria-hidden="true" /> Ask
        </a>
      {/if}
    </header>
    <main class="content" id="content" tabindex="-1">
      {@render children()}
    </main>
  </div>

  {#if org}
    <CommandMenu bind:open={menu} {org} {workspace} dockets={(data.dockets ?? []).filter((entry) => entry.open)} canAdminister={data.owner ?? false}
      canManageAccess={data.managesSystemAccounts ?? false}
    />
  {/if}

  <nav class="tabbar" aria-label="Quick links">
    {#if org}
      <a href={resolve('/o/[org]', { org: org.slug })} aria-current={current(orgPath(''))}><FolderOpen size={19} aria-hidden="true" /> Casebook</a>
      {#if workspace}
        <a
          href={resolve('/o/[org]/w/[ws]/overview', { org: org.slug, ws: workspace.slug })}
          aria-current={current(`/o/${org.slug}/w/${workspace.slug}/overview`)}><LayoutGrid size={19} aria-hidden="true" /> Docket</a
        >
        <a
          href={resolve('/o/[org]/w/[ws]/graph', { org: org.slug, ws: workspace.slug })}
          aria-current={current(`/o/${org.slug}/w/${workspace.slug}/graph`)}><Network size={19} aria-hidden="true" /> Record</a
        >
      {/if}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Ask's resolved path, on the open docket -->
      <a href="{resolve('/o/[org]/ask', { org: org.slug })}{askScope}" aria-current={current(orgPath('/ask'))}
        ><MessageSquareText size={19} aria-hidden="true" /> Ask</a
      >
    {:else}
      <a href={resolve('/')} aria-current={current('/')}><LayoutGrid size={19} aria-hidden="true" /> Home</a>
    {/if}
    <button type="button" onclick={() => (drawer = !drawer)} aria-expanded={drawer}>
      {#if drawer}<X size={19} aria-hidden="true" />{:else}<Menu size={19} aria-hidden="true" />{/if} Menu
    </button>
  </nav>
</div>

<style>
  .skip {
    position: absolute;
    left: -999px;
    top: 8px;
    z-index: 100;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--ink);
    color: var(--bg);
  }
  .skip:focus {
    left: 8px;
  }
  .shell {
    display: grid;
    grid-template-columns: 248px minmax(0, 1fr);
    min-height: 100dvh;
  }

  /* ── Sidebar ── */
  .side {
    position: sticky;
    top: 0;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 12px;
    background: var(--side);
    border-right: 1px solid var(--rule);
    z-index: 40;
  }
  .brand {
    position: relative;
  }
  .brand summary {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px;
    border-radius: 8px;
    list-style: none;
    cursor: pointer;
  }
  .brand summary::-webkit-details-marker {
    display: none;
  }
  .brand summary:hover {
    background: color-mix(in oklab, var(--sunk) 80%, transparent);
  }
  .brand-text {
    display: grid;
    gap: 4px;
    flex: 1;
    min-width: 0;
    line-height: 1.15;
  }
  .brand-text small {
    overflow: hidden;
    color: var(--mute);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .brand :global(.chev) {
    color: var(--mute);
    flex: none;
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: -40px;
    z-index: 60;
    display: grid;
    gap: 1px;
    padding: 8px;
    background: var(--paper);
    border-radius: 10px;
    box-shadow: var(--shadow-2);
    animation: rise 0.25s var(--ease-out) both;
  }
  .menu .label {
    padding: 4px 8px 6px;
  }
  .menu a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: 7px;
    text-decoration: none;
    font-size: 13.5px;
  }
  .menu a:hover,
  .menu a[aria-current='page'] {
    background: var(--sunk);
  }
  .menu .new {
    color: var(--mute);
  }
  .menu .grow {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .empty {
    margin: 4px 8px;
    font-size: 13px;
  }
  .org-mark {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: var(--ink);
    color: var(--bg);
    font: 600 9.5px/1 var(--font-mono);
    flex: none;
  }
  .jump {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--rule);
    border-radius: 8px;
    background: var(--paper);
    color: var(--mute);
    font: inherit;
    font-size: 13px;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .jump span {
    flex: 1;
  }
  .jump:hover {
    border-color: var(--rule-2);
    color: var(--ink);
  }
  .nav {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 -12px;
    padding: 0 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1px;
  }
  .primary a {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border-radius: 8px;
    color: var(--ink-2);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    transition: background 0.15s;
  }
  .primary a:hover,
  .dockets a:hover {
    background: color-mix(in oklab, var(--sunk) 80%, transparent);
  }
  .primary a[aria-current='page'],
  .dockets a[aria-current='page'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-1);
  }
  .primary a[aria-current='page']::before,
  .dockets a[aria-current='page']::before {
    content: '';
    position: absolute;
    left: -12px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--signal);
  }
  .section {
    padding: 16px 10px 6px;
  }
  .dockets a {
    position: relative;
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    gap: 0 8px;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 13.5px;
    text-decoration: none;
  }
  .dockets .closed {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    gap: 0 8px;
    padding: 6px 10px;
    color: var(--mute);
    font-size: 13.5px;
  }
  .dockets .closed .docket-name {
    grid-column: 2;
  }
  .dockets .docket-name {
    overflow-wrap: anywhere;
  }
  .dockets .no {
    grid-column: 2;
    color: var(--mute);
    font-size: 11px;
  }
  .sdot {
    align-self: center;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--mute);
  }
  .dockets a[aria-current='page'] .sdot {
    background: var(--ok);
    box-shadow: none;
  }
  .none {
    padding: 4px 10px;
    font-size: 13px;
  }
  /* Spaces +, then each space with its own + and its dockets beneath it. */
  .spaces-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-right: 4px;
  }
  .spaces {
    gap: 6px;
  }
  .space-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 8px;
  }
  .space-name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 8px;
    color: var(--ink-2);
    font-size: 13.5px;
    font-weight: 600;
    text-decoration: none;
  }
  .space-name:hover {
    background: color-mix(in oklab, var(--sunk) 80%, transparent);
  }
  .space-name[aria-current='page'] {
    background: var(--paper);
    color: var(--ink);
    box-shadow: var(--shadow-1);
  }
  .space-mark {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: var(--sunk);
    color: var(--ink-2);
    font: 600 10px/1 var(--font-mono);
  }
  .space-row.here .space-mark {
    background: var(--ink);
    color: var(--bg);
  }
  .add {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: var(--mute);
  }
  .add:hover,
  .add[aria-current='page'] {
    background: color-mix(in oklab, var(--sunk) 80%, transparent);
    color: var(--ink);
  }
  .space .dockets {
    margin-left: 18px;
    padding-left: 4px;
    border-left: 1px solid var(--rule);
  }
  .space .dockets a[aria-current='page']::before {
    left: -5px;
  }
  .foot {
    display: grid;
    gap: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--rule);
  }
  .notice {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 7px 8px;
    border: 1px solid color-mix(in srgb, var(--warn) 55%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    color: inherit;
    font-size: 12px;
    line-height: 1.35;
    text-decoration: none;
  }
  .notice :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .ai {
    display: grid;
    gap: 5px;
    padding: 0 6px;
    font-size: 12px;
  }
  .ai .label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ai .meter {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--rule);
    overflow: hidden;
  }
  .ai .meter span {
    display: block;
    height: 100%;
    background: var(--ink-2);
    transform-origin: left;
    animation: grow 0.8s var(--ease-out) both;
  }
  .ai .meter span.warn {
    background: var(--warn);
  }
  .ai .figures {
    color: var(--mute);
    font-variant-numeric: tabular-nums;
  }
  .ai .note {
    color: var(--warn);
  }
  .me {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 0 0 6px;
  }
  .who {
    display: grid;
    flex: 1;
    min-width: 0;
    line-height: 1.2;
    font-size: 13px;
  }
  .who b,
  .who small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who small {
    color: var(--mute);
    font-size: 11px;
  }
  .me form {
    display: contents;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--mute);
    cursor: pointer;
    flex: none;
  }
  .icon-btn:hover {
    background: var(--paper);
    border-color: var(--rule);
    color: var(--ink);
  }
  .scrim {
    display: none;
  }

  /* ── Breadcrumb bar ── */
  .main-col {
    min-width: 0;
  }
  .crumbs {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 50px;
    padding: 0 28px;
    background: color-mix(in oklab, var(--bg) 86%, transparent);
    backdrop-filter: blur(10px) saturate(1.3);
    border-bottom: 1px solid var(--rule);
    font-size: 13.5px;
    color: var(--mute);
  }
  .crumbs nav {
    min-width: 0;
  }
  .crumbs ol {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: hidden;
    white-space: nowrap;
  }
  .crumbs li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .crumbs a {
    text-decoration: none;
  }
  .crumbs a:hover {
    color: var(--ink);
  }
  .crumbs b {
    overflow: hidden;
    color: var(--ink);
    font-weight: 500;
    text-overflow: ellipsis;
  }
  .crumbs .sep {
    color: var(--rule-2);
  }
  .crumbs .grow {
    flex: 1;
  }
  .content {
    display: block;
    max-width: 1240px;
    margin: 0 auto;
    padding: 30px 28px 90px;
    outline: none;
  }
  .tabbar {
    display: none;
  }

  /* ── Wide screens: the sidebar's links scroll on their own when the window is short. ── */
  @media (min-width: 901px) {
    .nav {
      overflow-y: auto;
      scrollbar-width: thin;
    }
  }

  /* ── Phones: a tab bar at the bottom, and the sidebar as a drawer from it. ── */
  @media (max-width: 900px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      --tabbar-h: calc(62px + env(safe-area-inset-bottom));
    }
    .side {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: min(300px, 86vw);
      height: auto;
      overflow-y: auto;
      transform: translateX(-104%);
      transition: transform 0.3s var(--ease-out);
      box-shadow: var(--shadow-2);
      padding-bottom: calc(14px + var(--tabbar-h));
    }
    .drawer-open .side {
      transform: none;
    }
    .drawer-open .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 35;
      border: 0;
      background: rgb(10 10 8 / 0.38);
      animation: fade 0.2s both;
    }
    .crumbs {
      padding: 0 14px;
    }
    .crumbs .hide-sm {
      display: none;
    }
    .content {
      padding: 20px 16px calc(36px + var(--tabbar-h));
    }
    .tabbar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 45;
      display: grid;
      grid-auto-columns: 1fr;
      grid-auto-flow: column;
      padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
      background: color-mix(in oklab, var(--paper) 94%, transparent);
      backdrop-filter: blur(10px);
      border-top: 1px solid var(--rule);
    }
    .tabbar a,
    .tabbar button {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      min-height: 50px;
      padding: 6px 2px;
      border: 0;
      background: none;
      color: var(--mute);
      font: 500 11px/1.2 var(--font-sans);
      text-decoration: none;
      cursor: pointer;
    }
    .tabbar a[aria-current='page'] {
      color: var(--ink);
    }
    .tabbar a[aria-current='page'] :global(svg) {
      color: var(--signal);
    }
  }
</style>
