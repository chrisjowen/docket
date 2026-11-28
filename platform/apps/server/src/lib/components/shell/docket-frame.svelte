<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { Snippet } from 'svelte'

  import { href } from '$lib/href'
  import { WORKSPACE_TABS, activeTab } from '$lib/workspace-nav'

  /**
   * A docket's frame: its caption (number, opening date, schema, drafts and documents), its name and tabs, and
   * the tab's content below. The docket's layout draws it on the server's pages and in the web UI alike.
   */
  interface Props {
    data: {
      org: { slug: string }
      workspace: { slug: string; name: string; openedAt: string; documents: number; drafts: number; head: { number: number } | null }
      dockets: { slug: string; docketNo: string }[]
    }
    children: Snippet
  }

  let { data, children }: Props = $props()
  const ws = $derived({ org: data.org.slug, ws: data.workspace.slug })
  const active = $derived(activeTab(page.url.pathname, data.org.slug, data.workspace.slug))
  const docketNo = $derived(data.dockets.find((entry) => entry.slug === data.workspace.slug)?.docketNo ?? '')
  const opened = $derived(new Date(data.workspace.openedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }))

  // The underline slides to the current tab.
  let tabs = $state<HTMLElement>()
  let ink = $state<{ left: number; width: number } | null>(null)
  $effect(() => {
    void active
    const place = () => {
      const link = tabs?.querySelector<HTMLElement>('a[aria-current="page"]')
      ink = link ? { left: link.offsetLeft, width: link.offsetWidth } : null
    }
    place()
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => window.removeEventListener('resize', place)
  })
</script>

<header class="docket">
  <p class="caption">
    <span class="docket-no" data-testid="docket-no">{docketNo}</span>
    <span class="label">Opened {opened}</span>
    <span class="label" aria-hidden="true">·</span>
    <a class="label" href={resolve('/o/[org]/w/[ws]/ontology', ws)} data-testid="head">
      {data.workspace.head ? `Schema v${data.workspace.head.number}` : 'No schema yet'}
    </a>
    {#if data.workspace.drafts > 0}
      <span class="label" aria-hidden="true">·</span>
      <a class="label" href={resolve('/o/[org]/w/[ws]/ontology', ws)}>{data.workspace.drafts} open {data.workspace.drafts === 1 ? 'draft' : 'drafts'}</a>
    {/if}
    <span class="label" aria-hidden="true">·</span>
    <a class="label" href={resolve('/o/[org]/w/[ws]/documents', ws)} data-testid="documents">
      {data.workspace.documents} {data.workspace.documents === 1 ? 'document' : 'documents'}
    </a>
  </p>
  {#if active !== 'overview'}
    <p class="name">{data.workspace.name}</p>
  {/if}
  <nav class="tabs" aria-label="Docket" bind:this={tabs}>
    {#each WORKSPACE_TABS as tab (tab.key)}
      <a href={href(tab.route, ws)} aria-current={active === tab.key ? 'page' : undefined}>{tab.label}</a>
    {/each}
    {#if ink}<span class="ink" aria-hidden="true" style="left: {ink.left}px; width: {ink.width}px"></span>{/if}
  </nav>
</header>

<div class="section">
  {@render children()}
</div>

<style>
  .docket {
    margin: 0 0 1.4rem;
  }
  .caption {
    margin-bottom: 6px;
  }
  .caption a {
    text-decoration: none;
  }
  .caption a:hover {
    color: var(--ink);
  }
  .name {
    margin: 0;
    font: 400 2rem/1.05 var(--font-serif);
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    animation: rise 0.45s var(--ease-out) both;
  }
  .tabs {
    position: relative;
    display: flex;
    gap: 2px;
    margin-top: 0.7rem;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--rule);
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tabs a {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 40px;
    padding: 0 12px;
    color: var(--mute);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .tabs a:hover {
    color: var(--ink);
  }
  .tabs a[aria-current='page'] {
    color: var(--ink);
  }
  .ink {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: var(--ink);
    transition:
      left 0.3s var(--ease-io),
      width 0.3s var(--ease-io);
  }
  /* The docket's name leads; each section's own heading sits under its tab. */
  .section :global(h1:not(.display)) {
    font-size: 2rem;
  }
  /* A section's content fades up as it arrives. */
  .section > :global(*) {
    animation: rise 0.45s var(--ease-out) both;
  }
  @media (max-width: 760px) {
    .tabs a {
      padding-inline: 9px;
    }
  }
</style>
