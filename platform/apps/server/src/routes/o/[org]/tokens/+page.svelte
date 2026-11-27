<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { KeyRound, Pencil, Plug } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import NewToken from '$lib/components/credentials/new-token.svelte'
  import TokenForm from '$lib/components/credentials/token-form.svelte'

  let { data, form } = $props()

  const day = (value: string | null) => (value ? value.slice(0, 10) : '—')
  const when = (value: string | null) => (value ? value.replace('T', ' ').slice(0, 16) : 'Never')
  const reach = (dockets: { name: string }[] | null) => (dockets === null ? 'Every docket you reach' : dockets.map((docket) => docket.name).join(', '))

  /** The row being renamed: a connection's or a token's id. */
  let renaming = $state<string | null>(null)
  const live = $derived(data.tokens.filter((token) => token.status === 'live'))
  const past = $derived(data.tokens.filter((token) => token.status !== 'live'))
</script>

<svelte:head>
  <title>Your tokens & connections · {data.org.name}</title>
</svelte:head>

<h1>Your tokens & connections</h1>
<p class="muted lede">
  Everything that acts as you in {data.org.name}: each AI client you signed in, and each personal token you made. They
  never do more than you can, and you can narrow them to read-only or to some dockets. Their calls show in each docket's
  activity under the name you give them.
</p>

{#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}
{#if form?.created}<NewToken created={form.created} />{/if}

<section class="block">
  <h2><Plug size={18} aria-hidden="true" /> Connections</h2>
  <p class="muted small">One for each time you signed an AI client in with OAuth. Two installs of the same client are two connections.</p>
  <div class="card table-wrap">
    <table class="grid stackable" aria-label="Connections">
      <thead><tr><th>Connection</th><th>Reaches</th><th>Access</th><th>Signed in</th><th>Last used</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>
        {#each data.connections as connection (connection.id)}
          <tr data-testid="connection-row">
            <td data-label="Connection">
              {#if renaming === connection.id}
                <form method="POST" action="?/renameConnection" class="rename">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="connection" value={connection.id} />
                  <label class="visually-hidden" for="name-{connection.id}">New name</label>
                  <input id="name-{connection.id}" name="name" value={connection.name} maxlength="80" required />
                  <button class="button small primary" type="submit">Save</button>
                  <button class="button small" type="button" onclick={() => (renaming = null)}>Cancel</button>
                </form>
              {:else}
                <strong>{connection.name}</strong><br /><span class="small muted">{connection.client}</span>
              {/if}
            </td>
            <td data-label="Reaches" class="small">{reach(connection.dockets)}</td>
            <td data-label="Access" class="small">{connection.readOnly ? 'Read-only' : 'As you'}</td>
            <td data-label="Signed in" class="small">{day(connection.createdAt)}</td>
            <td data-label="Last used" class="small">{when(connection.lastUsedAt)}</td>
            <td><div class="actions">
              {#if renaming !== connection.id}
                <button class="button small" type="button" onclick={() => (renaming = connection.id)} aria-label="Rename {connection.name}">
                  <Pencil size={14} aria-hidden="true" /> Rename
                </button>
              {/if}
              <form method="POST" action="?/revokeConnection">
                <Csrf token={data.csrf} />
                <input type="hidden" name="connection" value={connection.id} />
                <button class="button small danger" type="submit" aria-label="Revoke {connection.name}">Revoke</button>
              </form>
            </div></td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">You have not signed an AI client in yet. A docket's Connect page shows how.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<section class="block">
  <h2><KeyRound size={18} aria-hidden="true" /> Personal tokens</h2>
  <p class="muted small">For scripts and headless agents that act as you. A token lasts at most 90 days.</p>
  <TokenForm csrf={data.csrf} dockets={data.dockets} expiryChoices={data.expiryChoices} defaultDays={data.defaultDays} owner="you" />

  <div class="card table-wrap">
    <table class="grid stackable" aria-label="Personal tokens">
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
            <td data-label="Access" class="small">{token.readOnly ? 'Read-only' : 'As you'}</td>
            <td data-label="Expires" class="small">{day(token.expiresAt)}</td>
            <td data-label="Last used" class="small">{when(token.lastUsedAt)}</td>
            <td><div class="actions">
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
            </div></td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">No live personal tokens.</td></tr>
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

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.35rem;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.2rem;
    margin: 0 0 0.4rem;
  }
  .lede {
    max-width: 48rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .block {
    margin-block: 1.75rem;
  }
  .block > p {
    margin: 0 0 0.75rem;
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
  .rename input[name='name'] {
    min-width: 12rem;
  }
  .past {
    margin-top: 0.75rem;
  }
  @media (max-width: 720px) {
    .actions {
      justify-content: flex-start;
      padding-top: 0.4rem;
    }
  }
</style>
