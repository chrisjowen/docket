<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { BellRing, Server } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import OrgSettingsTabs from '$lib/components/org-settings-tabs.svelte'

  let { data, form } = $props()

  const day = (value: string | null) => (value ? value.slice(0, 10) : '—')
  const own = $derived(data.accounts.filter((account) => !account.managed))
  const managed = $derived(data.accounts.filter((account) => account.managed))
</script>

<svelte:head>
  <title>System accounts · {data.org.name}</title>
</svelte:head>

<h1>Settings</h1>
<OrgSettingsTabs org={data.org.slug} active="system-accounts" owner={data.owner} />

<p class="muted lede">
  A system account is anything that is not a person: CI, an integration, a bot. It belongs to {data.org.name}, outlives
  whoever made it, and acts only through its tokens. No person acts for it: what it writes is its own, so its evidence cites
  its sources. This is the one place to create one, give it access and issue its tokens. {data.org.name}'s owners are told
  before its tokens expire.
</p>

{#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}

{#if data.notices.length}
  <section class="card notices" data-testid="token-notices" aria-label="Token notices">
    <h2><BellRing size={16} aria-hidden="true" /> Tokens to renew</h2>
    <ul>
      {#each data.notices as notice (notice.tokenId)}
        <li>
          <a href={resolve('/o/[org]/settings/system-accounts/[id]', { org: data.org.slug, id: notice.accountId })}>{notice.account}</a>:
          token <strong>{notice.name ?? `${notice.prefix}…`}</strong>
          {notice.expired ? 'expired on' : 'expires on'} {day(notice.expiresAt)}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card table-wrap">
  <table class="grid stackable" aria-label="System accounts">
    <thead><tr><th>System account</th><th>May</th><th>Live tokens</th><th>Next expiry</th><th>Last used</th></tr></thead>
    <tbody>
      {#each own as account (account.id)}
        <tr data-service={account.name}>
          <td data-label="System account">
            <a class="name" href={resolve('/o/[org]/settings/system-accounts/[id]', { org: data.org.slug, id: account.id })}>
              <Server size={15} aria-hidden="true" /> <strong class="mono">{account.name}</strong>
            </a>
            {#if account.description}<div class="muted small">{account.description}</div>{/if}
          </td>
          <td data-label="May" class="small">{account.access}</td>
          <td data-label="Live tokens" class="small">{account.liveTokens}</td>
          <td data-label="Next expiry" class="small">{day(account.nextExpiry)}</td>
          <td data-label="Last used" class="small">{day(account.lastUsedAt)}</td>
        </tr>
      {:else}
        <tr><td colspan="5" class="muted">No system accounts yet.</td></tr>
      {/each}
    </tbody>
  </table>
</section>

<form method="POST" action="?/create" class="card create" data-testid="new-system-account">
  <Csrf token={data.csrf} />
  <h2>New system account</h2>
  <label>
    Name
    <input name="name" required placeholder="github-sync" pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]" maxlength="40" autocomplete="off" />
  </label>
  <label class="grow">
    What it is for <span class="muted">(optional)</span>
    <input name="description" maxlength="200" placeholder="GitHub Actions: docket push on main" />
  </label>
  <label>
    It may
    <select name="role">
      {#each data.roles as entry (entry.role)}<option value={entry.role} selected={entry.role === 'viewer'}>{entry.label}</option>{/each}
    </select>
  </label>
  <div><button class="button primary" type="submit"><Server size={14} aria-hidden="true" /> Create system account</button></div>
</form>

{#if managed.length}
  <h2 class="managed">Managed by the org admin API</h2>
  <p class="muted small">Made through {data.org.name}'s master key, each for one database. They are listed here and changed only through that API.</p>
  <ul class="card list">
    {#each managed as account (account.id)}
      <li><span class="mono">{account.name}</span><span class="muted small">{account.liveTokens} live tokens</span></li>
    {/each}
  </ul>
{/if}

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.35rem;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.1rem;
    margin: 0 0 0.6rem;
  }
  .lede {
    max-width: 48rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .notices {
    padding: 0.9rem 1.1rem;
    margin-bottom: 1rem;
    border-color: color-mix(in srgb, var(--warn) 60%, transparent);
    background: color-mix(in srgb, var(--warn) 8%, transparent);
  }
  .notices ul {
    margin: 0;
    padding-left: 1.1rem;
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .create {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
    padding: 1rem 1.1rem;
    margin-top: 1rem;
  }
  .create h2 {
    flex-basis: 100%;
  }
  .create label {
    display: grid;
    gap: 0.3rem;
    min-width: min(100%, 12rem);
  }
  .grow {
    flex: 1;
  }
  .managed {
    margin-top: 2rem;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
  }
  .list li {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    flex-wrap: wrap;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .list li:last-child {
    border-bottom: 0;
  }
</style>
