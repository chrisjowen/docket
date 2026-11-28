<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { Check, Minus, Plus, Search } from '@lucide/svelte'

  import { CAPABILITIES, CAPABILITY_INFO } from '@docket/platform-tenancy/roles'

  import { sparkline } from '$lib/docket'

  let { data } = $props()
  const rows = $derived(
    CAPABILITIES.map((action) => ({
      action,
      label: CAPABILITY_INFO[action].label,
      allowed: data.permissions[action],
    })),
  )
  const details = $derived(new Map(data.casebook.map((docket) => [docket.slug, docket])))
  const spaceOf = $derived(new Map(data.spaces.map((space) => [space.id, space])))
  const updated = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
</script>

<svelte:head>
  <title>{data.org.name} · Docket Cloud</title>
</svelte:head>

<div class="page-head">
  <div class="titles">
    <p class="caption">
      <span class="label">{data.org.name}</span>
      <span class="label" aria-hidden="true">·</span>
      <span class="label">{data.members} {data.members === 1 ? 'member' : 'members'}</span>
      <span class="label" aria-hidden="true">·</span>
      <span class="label">You are <span class="badge" class:owner={data.owner} data-testid="my-role">{data.role}</span></span>
    </p>
    <h1>Home</h1>
    <p class="lede">
      Every docket {data.org.name} keeps on record, space by space. Open one to read its records, walk its evidence or ask it a question. What you can
      do in each comes from your role on the whole account, on its space, or on that docket.
    </p>
  </div>
  <div class="actions">
    <a class="button" href="{resolve('/a/[acct]/ask', { acct: data.org.slug })}?mode=search"><Search size={16} aria-hidden="true" /> Search the account</a>
    {#if data.createsDockets}
      <a class="button primary" href={resolve('/a/[acct]/dockets/new', { acct: data.org.slug })}><Plus size={16} aria-hidden="true" /> New docket</a>
    {/if}
  </div>
</div>

{#if page.url.searchParams.get('deleted')}
  <p class="flash" role="status">Deleted the docket {page.url.searchParams.get('deleted')}.</p>
{/if}

<section class="card dockets" aria-labelledby="dockets-title">
  <h2 id="dockets-title" class="visually-hidden">Dockets</h2>
  {#if data.dockets.length}
    <div class="table-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th scope="col">Docket</th>
            <th scope="col" class="hide-sm">Space</th>
            <th scope="col">Docket no.</th>
            <th scope="col">Status</th>
            <th scope="col" class="num">Documents</th>
            <th scope="col" class="hide-sm">Filings, 12 mo</th>
            <th scope="col" class="hide-sm">Updated</th>
          </tr>
        </thead>
        <tbody class="reveal">
          {#each data.dockets as workspace, index (workspace.slug)}
            {@const docket = details.get(workspace.slug)}
            {@const spark = sparkline(docket?.filings ?? [])}
            <tr style="--i: {index}">
              <td>
                {#if workspace.open}
                  <a class="docket-name" href={resolve('/a/[acct]/d/[docket]/overview', { acct: data.org.slug, docket: workspace.slug })}>{workspace.name}</a>
                {:else}
                  <span class="docket-name muted">{workspace.name}</span>
                {/if}
              </td>
              <td class="hide-sm">
                {#if spaceOf.get(workspace.spaceId)}
                  {@const space = spaceOf.get(workspace.spaceId)}
                  <a class="space" href={resolve('/a/[acct]/s/[space]', { acct: data.org.slug, space: space?.slug ?? '' })}>{space?.name}</a>
                {/if}
              </td>
              <td class="mono no">{workspace.docketNo}</td>
              <td>
                {#if !workspace.open}
                  <span class="muted">No access</span>
                {:else if docket?.standing === 'active'}
                  <span class="status"><i></i>Active</span>
                {:else}
                  <span class="status warn"><i></i>Dormant</span>
                {/if}
              </td>
              <td class="num mono">{docket?.documents ?? 0}</td>
              <td class="hide-sm">
                <svg class="spark" viewBox="0 0 96 24" aria-label="{docket?.filings.reduce((sum, count) => sum + count, 0) ?? 0} filings in 12 months" role="img">
                  <path class="a" d={spark.area} />
                  <path d={spark.line} />
                </svg>
              </td>
              <td class="hide-sm mono muted">{docket ? updated(docket.updatedAt) : ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="empty muted">
      No dockets yet. {data.createsDockets
        ? 'Open one from a space’s +: a template, a description of your domain, an entities.yaml file, or another docket.'
        : 'Someone who can create dockets opens them.'}
    </p>
  {/if}
</section>

<section class="card perms-card" aria-labelledby="perms-title">
  <h2 id="perms-title">What you <em>can do</em> across all of {data.org.name}</h2>
  <p class="muted perms-note">A role on a space or on one docket adds to this there: each space's Users & system accounts, and each docket's Access tab, say what you may do and why.</p>
  <ul class="perms">
    {#each rows as row (row.action)}
      <li data-action={row.action} data-allowed={row.allowed}>
        {#if row.allowed}
          <Check size={16} aria-hidden="true" class="yes" />
        {:else}
          <Minus size={16} aria-hidden="true" class="no" />
        {/if}
        <span>{row.label}</span>
        <span class="visually-hidden">{row.allowed ? 'allowed' : 'not allowed'}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .dockets {
    overflow: hidden;
  }
  .docket-name {
    font: 400 1.35rem/1.1 var(--font-serif);
    text-decoration: none;
  }
  .docket-name:hover {
    color: var(--signal);
  }
  .space {
    color: var(--ink-2);
    font-size: 0.875rem;
    text-decoration: none;
  }
  .space:hover {
    color: var(--signal);
  }
  .num {
    text-align: right;
  }
  .no {
    white-space: nowrap;
  }
  th.num {
    text-align: right;
  }
  .spark {
    display: block;
    width: 96px;
    height: 24px;
  }
  .spark path {
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 1.4;
  }
  .spark path.a {
    fill: color-mix(in oklab, var(--signal) 14%, transparent);
    stroke: none;
  }
  .empty {
    margin: 0;
    padding: 1.1rem 1.25rem;
  }
  .perms-card {
    margin-top: 14px;
    padding: 18px 20px;
    max-width: 44rem;
  }
  .perms-card h2 {
    margin: 0 0 6px;
  }
  .perms-note {
    margin: 0 0 12px;
    font-size: 0.875rem;
  }
  .perms {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }
  .perms li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .perms li[data-allowed='false'] {
    color: var(--mute);
  }
  .perms :global(.yes) {
    color: var(--ok);
  }
  @media (max-width: 900px) {
    .hide-sm {
      display: none;
    }
  }
</style>
