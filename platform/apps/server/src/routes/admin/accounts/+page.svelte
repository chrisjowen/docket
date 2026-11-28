<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Ban, Play } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import OperatorTabs from '$lib/components/operator-tabs.svelte'

  let { data, form } = $props()
  const day = (iso: string) => iso.slice(0, 10)
  const STATUS = { active: 'active', suspended: 'suspended', provisioning: 'setting up', deleted: 'deleted' } as const
</script>

<svelte:head>
  <title>Accounts · Operator console</title>
</svelte:head>

<div class="admin">
  <h1>Operator console</h1>
  <p class="muted">
    Every account on this server, newest first. The platform holds {data.platform.live} of {data.platform.max} accounts. You see who owns each one and how
    many people, system accounts and open invites it has, never anything of its content.
  </p>
  <OperatorTabs active="accounts" />

  {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
  {#if form && 'flash' in form}<p class="flash" role="status">{form.flash}</p>{/if}

  <section class="card table-wrap">
    <table class="grid stackable" aria-label="Accounts">
      <thead>
        <tr><th>Account</th><th>Owners</th><th>People</th><th>Seats</th><th>Dockets</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr>
      </thead>
      <tbody>
        {#each data.accounts as account (account.id)}
          <tr data-account={account.slug}>
            <td data-label="Account">
              <strong>{account.name}</strong>
              <div class="muted small mono">/a/{account.slug} · since {day(account.createdAt)}</div>
            </td>
            <td data-label="Owners" class="small">{account.owners.length ? account.owners.map((login) => `@${login}`).join(', ') : '—'}</td>
            <td data-label="People" class="small">
              {account.people}
              <div class="muted">{account.systemAccounts} system · {account.openInvites} invited</div>
            </td>
            <td data-label="Seats" class="small">{account.limits.maxMembers ?? `${data.defaults.maxMembers} (beta)`}</td>
            <td data-label="Dockets" class="small">{account.limits.maxDockets ?? `${data.defaults.maxDockets} (beta)`}</td>
            <td data-label="Status" class="small">
              <span class="badge" class:warn={account.status === 'suspended'}>{STATUS[account.status]}</span>
              {#if account.suspended}
                <div class="muted">
                  {day(account.suspended.at)}{account.suspended.by ? ` by @${account.suspended.by}` : ''}{account.suspended.reason ? `: ${account.suspended.reason}` : ''}
                </div>
              {/if}
            </td>
            <td class="actions">
              <details>
                <summary class="button small">Change</summary>
                <div class="panel">
                  <form method="POST" action="?/limits" class="limits">
                    <Csrf token={data.csrf} />
                    <input type="hidden" name="account" value={account.slug} />
                    <label>
                      Seats
                      <input name="max_members" type="number" min="1" max="10000" inputmode="numeric" value={account.limits.maxMembers ?? ''} placeholder={String(data.defaults.maxMembers)} />
                    </label>
                    <label>
                      Dockets
                      <input name="max_dockets" type="number" min="1" max="1000" inputmode="numeric" value={account.limits.maxDockets ?? ''} placeholder={String(data.defaults.maxDockets)} />
                    </label>
                    <button class="button small" type="submit">Set limits</button>
                    <p class="muted fine">Blank: the beta's. Lowering a limit keeps what the account has and refuses anything new.</p>
                  </form>
                  {#if account.status === 'active'}
                    <form method="POST" action="?/suspend" class="suspend">
                      <Csrf token={data.csrf} />
                      <input type="hidden" name="account" value={account.slug} />
                      <label>
                        Why <span class="muted">(operators see this)</span>
                        <input name="reason" maxlength="300" placeholder="Unpaid invoice, abuse report…" />
                      </label>
                      <button class="button small danger" type="submit"><Ban size={14} aria-hidden="true" /> Suspend {account.name}</button>
                      <p class="muted fine">Its pages, API, MCP addresses, tokens and connections stop answering. Nothing in it is lost.</p>
                    </form>
                  {:else if account.status === 'suspended'}
                    <form method="POST" action="?/resume">
                      <Csrf token={data.csrf} />
                      <input type="hidden" name="account" value={account.slug} />
                      <button class="button small primary" type="submit"><Play size={14} aria-hidden="true" /> Resume {account.name}</button>
                    </form>
                  {/if}
                </div>
              </details>
            </td>
          </tr>
        {:else}
          <tr><td colspan="7" class="muted">No accounts yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
</div>

<style>
  .admin {
    max-width: 72rem;
    margin: 0 auto;
    padding: 0.5rem 0 1rem;
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 0.35rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .fine {
    font-size: 0.75rem;
    margin: 0.25rem 0 0;
  }
  .card {
    margin-top: 1rem;
  }
  .badge.warn {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 45%, transparent);
  }
  .actions {
    text-align: right;
  }
  details summary {
    list-style: none;
    cursor: pointer;
  }
  details summary::-webkit-details-marker {
    display: none;
  }
  .panel {
    display: grid;
    gap: 0.9rem;
    margin-top: 0.6rem;
    padding: 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    text-align: left;
    min-width: min(20rem, 100%);
  }
  .panel form {
    display: grid;
    gap: 0.4rem;
  }
  .limits {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .limits button,
  .limits p {
    grid-column: 1 / -1;
  }
  .panel label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.8125rem;
  }
  .panel input {
    width: 100%;
    min-width: 0;
  }
  .flash,
  .alert {
    max-width: 44rem;
  }
</style>
