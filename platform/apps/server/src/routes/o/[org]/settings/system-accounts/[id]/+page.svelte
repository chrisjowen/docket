<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowLeft, BellRing, KeyRound, Pencil, Server } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import NewToken from '$lib/components/credentials/new-token.svelte'
  import TokenForm from '$lib/components/credentials/token-form.svelte'
  import OrgSettingsTabs from '$lib/components/org-settings-tabs.svelte'

  let { data, form } = $props()

  const day = (value: string | null) => (value ? value.slice(0, 10) : '—')
  const when = (value: string | null) => (value ? value.replace('T', ' ').slice(0, 16) : 'Never')
  const reach = (dockets: { name: string }[] | null) => (dockets === null ? 'Every docket it reaches' : dockets.map((docket) => docket.name).join(', '))
  let renaming = $state<string | null>(null)
  const live = $derived(data.tokens.filter((token) => token.status === 'live'))
  const past = $derived(data.tokens.filter((token) => token.status !== 'live'))
</script>

<svelte:head>
  <title>{data.account.name} · System accounts · {data.org.name}</title>
</svelte:head>

<h1>Settings</h1>
<OrgSettingsTabs org={data.org.slug} active="system-accounts" owner={data.permissions['org.administer']} />
<p><a class="back small" href={resolve('/o/[org]/settings/system-accounts', { org: data.org.slug })}><ArrowLeft size={14} aria-hidden="true" /> System accounts</a></p>

<header class="account">
  <Server size={22} aria-hidden="true" />
  <div>
    <h2 class="mono">{data.account.name}</h2>
    <p class="muted small">
      System account of {data.org.name}{data.account.createdBy ? `, made by @${data.account.createdBy}` : ''} on {day(data.account.createdAt)}.
      Its writes are its own, as “{data.account.name} with token ‘…’”.
    </p>
  </div>
</header>

{#if data.created}<p class="flash" role="status">Created {data.account.name}. Issue it a token below.</p>{/if}
{#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}
{#if form?.created}<NewToken created={form.created} />{/if}

{#if data.notices.length}
  <section class="card notices" data-testid="token-notices">
    <p><BellRing size={15} aria-hidden="true" />
      {#each data.notices as notice, index (notice.tokenId)}{index ? '; ' : ''}<strong>{notice.name ?? `${notice.prefix}…`}</strong> {notice.expired ? 'expired on' : 'expires on'} {day(notice.expiresAt)}{/each}.
      Issue a new token, move what uses it over, then revoke the old one.</p>
  </section>
{/if}

{#if data.account.managed}
  <p class="muted">Managed through the org admin API: it is changed there, not here.</p>
{:else if data.mayChange}
  <section class="grid-2">
    <form method="POST" action="?/access" class="card section">
      <Csrf token={data.csrf} />
      <h3>What it may do</h3>
      <label>
        Across {data.org.name}
        <select name="role">
          {#each data.roles as entry (entry.role)}<option value={entry.role} selected={entry.role === data.account.role}>{entry.label}</option>{/each}
        </select>
      </label>
      <p class="muted small">Its tokens act as it, narrowed as each says: a change here reaches them from their next call.</p>
      <div><button class="button small" type="submit">Save</button></div>
    </form>
    <form method="POST" action="?/describe" class="card section">
      <Csrf token={data.csrf} />
      <h3>What it is for</h3>
      <label>
        Description
        <input name="description" maxlength="200" value={data.account.description ?? ''} placeholder="GitHub Actions: docket push on main" />
      </label>
      <div><button class="button small" type="submit">Save</button></div>
    </form>
  </section>
{:else}
  <p class="muted">It may: {data.account.access}. Your role cannot change it.</p>
{/if}

<section class="block">
  <h3><KeyRound size={17} aria-hidden="true" /> Tokens</h3>
  {#if data.mayChange}
    <TokenForm
      csrf={data.csrf}
      dockets={data.reachable}
      expiryChoices={data.expiryChoices}
      defaultDays={data.defaultDays}
      owner={data.account.name}
      placeholder="actions"
    />
  {/if}
  <div class="card table-wrap">
    <table class="grid stackable" aria-label="Tokens">
      <thead><tr><th>Token</th><th>Reaches</th><th>Access</th><th>Expires</th><th>Last used</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>
        {#each live as token (token.id)}
          <tr data-testid="token-row">
            <td data-label="Token">
              {#if renaming === token.id}
                <form method="POST" action="?/renameToken" class="rename">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="token" value={token.id} />
                  <label class="visually-hidden" for="name-{token.id}">New name</label>
                  <input id="name-{token.id}" name="name" value={token.name ?? ''} maxlength="200" required />
                  <button class="button small primary" type="submit">Save</button>
                  <button class="button small" type="button" onclick={() => (renaming = null)}>Cancel</button>
                </form>
              {:else}
                <strong>{token.name ?? 'Unnamed'}</strong><br /><span class="mono small muted">{token.prefix}…</span>
              {/if}
            </td>
            <td data-label="Reaches" class="small">{reach(token.dockets)}</td>
            <td data-label="Access" class="small">{token.readOnly ? 'Read-only' : `As ${data.account.name}`}</td>
            <td data-label="Expires" class="small">{day(token.expiresAt)}</td>
            <td data-label="Last used" class="small">{when(token.lastUsedAt)}</td>
            <td>
              {#if data.mayChange}
                <div class="actions">
                  {#if renaming !== token.id}
                    <button class="button small" type="button" onclick={() => (renaming = token.id)} aria-label="Rename {token.name ?? token.prefix}">
                      <Pencil size={14} aria-hidden="true" /> Rename
                    </button>
                  {/if}
                  <form method="POST" action="?/revokeToken">
                    <Csrf token={data.csrf} />
                    <input type="hidden" name="token" value={token.id} />
                    <button class="button small danger" type="submit" aria-label="Revoke {token.name ?? token.prefix}">Revoke</button>
                  </form>
                </div>
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">No live tokens.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if past.length}
    <details class="past">
      <summary class="muted small">{past.length} revoked or expired</summary>
      <ul class="small muted">
        {#each past as token (token.id)}<li><span class="mono">{token.prefix}…</span> {token.name ?? ''} · {token.status} · {day(token.expiresAt)}</li>{/each}
      </ul>
    </details>
  {/if}
</section>

{#if data.mayChange}
  <form method="POST" action="?/remove" class="remove">
    <Csrf token={data.csrf} />
    <button class="button danger" type="submit">Remove {data.account.name} and revoke its tokens</button>
  </form>
{/if}

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.35rem;
  }
  h2 {
    margin: 0;
    font-size: 1.4rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.6rem;
    font-size: 1.05rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .account {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin: 0.5rem 0 1rem;
  }
  .account p {
    margin: 0.2rem 0 0;
  }
  .notices {
    padding: 0.8rem 1rem;
    margin-bottom: 1rem;
    border-color: color-mix(in srgb, var(--warn) 60%, transparent);
    background: color-mix(in srgb, var(--warn) 8%, transparent);
  }
  .notices p {
    margin: 0;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: 1rem;
  }
  .section {
    display: grid;
    gap: 0.6rem;
    padding: 1rem 1.1rem;
  }
  .section p {
    margin: 0;
  }
  .section label {
    display: grid;
    gap: 0.3rem;
  }
  .block {
    margin-block: 1.75rem;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .rename {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .past {
    margin-top: 0.75rem;
  }
  .remove {
    margin-top: 2rem;
  }
  @media (max-width: 720px) {
    .actions {
      justify-content: flex-start;
      padding-top: 0.4rem;
    }
  }
</style>
