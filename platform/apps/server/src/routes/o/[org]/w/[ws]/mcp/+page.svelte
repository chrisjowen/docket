<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Bot, Check, Copy, KeyRound, Plug, ScrollText, Server, Terminal } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()

  let copied = $state<string | null>(null)
  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      copied = id
      setTimeout(() => (copied = copied === id ? null : copied), 1500)
    } catch {
      copied = null
    }
  }

  const day = (value: string | null) => (value ? value.slice(0, 10) : '—')
  const reach = (dockets: { slug: string; name: string }[] | null) => (dockets === null ? 'Every docket' : dockets.map((docket) => docket.name).join(', '))
  const when = (value: string | null) => (value ? value.replace('T', ' ').slice(0, 16) : '—')

  const snippets = $derived({
    claude: `claude mcp add --transport http docket ${data.endpoint}`,
    json: JSON.stringify({ mcpServers: { docket: { type: 'http', url: data.endpoint } } }, null, 2),
    token: `claude mcp add --transport http docket ${data.endpoint} \\\n  --header "Authorization: Bearer $DOCKET_TOKEN"`,
    curl: `curl -s ${data.endpoint} \\\n  -H "Authorization: Bearer $DOCKET_TOKEN" -H 'Content-Type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"docket_search","arguments":{"query":"orders"}}}'`,
  })
</script>

<svelte:head>
  <title>MCP · {data.workspace.name}</title>
</svelte:head>

<h1>Connect an agent</h1>
<p class="muted lede">
  Agents read this docket's knowledge over MCP, always as someone: you, signing in with OAuth or with a personal token,
  or a system account with its token. A credential acts as whoever owns it and can only be narrowed, to read-only or to
  some dockets, never widened. Every call is audited.
</p>

<section class="card endpoint">
  <span class="label">Endpoint</span>
  <code class="mono" data-testid="endpoint">{data.endpoint}</code>
  <button class="button small" type="button" onclick={() => copy('endpoint', data.endpoint)}>
    {#if copied === 'endpoint'}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy{/if}
  </button>
</section>

<div class="ways">
  <section class="card way">
    <h2><Bot size={18} aria-hidden="true" /> As yourself, by signing in</h2>
    <p class="muted">
      The client opens a browser, you sign in, name the connection ("Claude Code — work laptop") and choose its dockets and
      whether it only reads. Its tokens last 15 minutes and renew for 30 days.
    </p>
    <p class="snippet-label">Claude Code</p>
    <pre class="snippet"><code>{snippets.claude}</code></pre>
    <p class="snippet-label">Claude Desktop, Cursor and other clients' JSON</p>
    <pre class="snippet"><code>{snippets.json}</code></pre>
  </section>
  <section class="card way">
    <h2><Terminal size={18} aria-hidden="true" /> As yourself, with a personal token</h2>
    <p class="muted">
      Create one below for this docket, or on <a href={resolve('/o/[org]/tokens', { org: data.org.slug })}>Your tokens & connections</a>
      for several. Keep it in a secret store as <span class="mono">DOCKET_TOKEN</span> and send it as a bearer token, never in a URL.
    </p>
    <p class="snippet-label">Claude Code</p>
    <pre class="snippet"><code>{snippets.token}</code></pre>
    <p class="snippet-label">Any HTTP client</p>
    <pre class="snippet"><code>{snippets.curl}</code></pre>
  </section>
  <section class="card way">
    <h2><Server size={18} aria-hidden="true" /> As a system account</h2>
    <p class="muted">
      For CI, integrations and bots: anything that is not a person. System accounts belong to {data.org.name}, outlive whoever made
      them, and are created, given access and issued tokens in one place: Settings › System accounts. Their tokens are used just
      like a personal one.
    </p>
    {#if data.permissions?.['members.manage']}
      <p><a class="button small" href={resolve('/o/[org]/settings/system-accounts', { org: data.org.slug })}>Open System accounts</a></p>
    {:else}
      <p class="muted small">Ask an admin of {data.org.name} for one.</p>
    {/if}
  </section>
</div>

{#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}
{#if form?.created}
  <section class="card created" data-testid="new-token">
    <p><strong>Your new token</strong> - shown once. It expires on {day(form.created.expiresAt)}.</p>
    <div class="token-row">
      <code class="mono" data-testid="token-value">{form.created.token}</code>
      <button class="button small" type="button" onclick={() => copy('token', form.created?.token ?? '')}>
        {#if copied === 'token'}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy{/if}
      </button>
    </div>
  </section>
{/if}

<section class="block">
  <h2><KeyRound size={18} aria-hidden="true" /> Tokens that reach this docket</h2>
  <form method="POST" action="?/createToken" class="card create">
    <Csrf token={data.csrf} />
    <label class="wide">Name <input name="name" maxlength="200" placeholder="CI on platform-api" required /></label>
    <label>
      Expires in
      <select name="days">
        {#each data.expiryChoices as days (days)}<option value={days} selected={days === data.defaultDays}>{days} days</option>{/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" name="readOnly" checked={data.readOnlyHere} disabled={data.readOnlyHere} />
      <span>Read-only <span class="muted small">{data.readOnlyHere ? 'You can only read this docket, so your tokens only read.' : 'Search, read and ask; never write.'}</span></span>
    </label>
    <p class="muted small wide">A personal token for this docket only. It does what you can do here, and stops when you lose access.</p>
    <div class="wide"><button class="button primary" type="submit">Create token</button></div>
  </form>

  <div class="card table-wrap">
    <table class="grid stackable" aria-label="API tokens">
      <thead><tr><th>Token</th><th>Owner</th><th>Reaches</th><th>Access</th><th>Expires</th><th>Last used</th><th></th></tr></thead>
      <tbody>
        {#each data.tokens as token (token.id)}
          <tr data-testid="token-row">
            <td data-label="Token"><strong>{token.name ?? 'Unnamed'}</strong><br /><span class="mono small muted">{token.prefix}…</span></td>
            <td data-label="Owner" class="small">{token.owner}{#if token.ownerKind === 'service'} <span class="badge">system account</span>{/if}</td>
            <td data-label="Reaches" class="small">{reach(token.dockets)}</td>
            <td data-label="Access" class="small">{token.readOnly ? 'Read-only' : 'As its owner'}</td>
            <td data-label="Expires" class="small">{day(token.expiresAt)}</td>
            <td data-label="Last used" class="small">{when(token.lastUsedAt)}</td>
            <td>
              {#if token.status !== 'live'}
                <span class="badge">{token.status}</span>
              {:else if token.revocable}
                <form method="POST" action="?/revokeToken">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="token" value={token.id} />
                  <button class="button small danger" type="submit">Revoke</button>
                </form>
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="7" class="muted">No tokens reach this docket yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<section class="block">
  <h2><Plug size={18} aria-hidden="true" /> Connections</h2>
  <p class="muted small">Each OAuth sign-in by an AI client, under the name it was given. Rename yours on Your tokens & connections.</p>
  <div class="card table-wrap">
    <table class="grid stackable" aria-label="Connections">
      <thead><tr><th>Connection</th><th>Signed in as</th><th>Reaches</th><th>Access</th><th>Last used</th><th></th></tr></thead>
      <tbody>
        {#each data.connections as connection (connection.id)}
          <tr data-testid="grant-row">
            <td data-label="Connection"><strong>{connection.name}</strong><br /><span class="small muted">{connection.client}</span></td>
            <td data-label="Signed in as" class="small">{connection.user}</td>
            <td data-label="Reaches" class="small">{reach(connection.dockets)}</td>
            <td data-label="Access" class="small">{connection.readOnly ? 'Read-only' : 'As its owner'}</td>
            <td data-label="Last used" class="small">{when(connection.lastUsedAt ?? connection.createdAt)}</td>
            <td>
              {#if connection.revocable}
                <form method="POST" action="?/revokeConnection">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="connection" value={connection.id} />
                  <button class="button small danger" type="submit">Revoke</button>
                </form>
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="6" class="muted">No client has signed in yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<section class="block">
  <h2><ScrollText size={18} aria-hidden="true" /> MCP audit</h2>
  <p class="muted small">
    {data.full ? 'Every MCP call, sign-in and token change in this docket' : 'Your own calls and tokens'}, newest first.
    Arguments are never stored: only their SHA-256 digest.
  </p>
  <div class="card table-wrap">
    <table class="grid" aria-label="MCP audit">
      <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>Arguments</th><th>ms</th></tr></thead>
      <tbody>
        {#each data.events as entry (entry.id)}
          <tr data-testid="audit-row">
            <td class="mono small">{when(entry.at)}</td>
            <td class="mono small">{entry.actor}</td>
            <td class="mono small">{entry.action}</td>
            <td class="mono small">{entry.target.join(', ')}</td>
            <td><span class="badge outcome-{entry.outcome}">{entry.outcome}</span></td>
            <td class="mono small muted" title={entry.argsDigest ?? ''}>{entry.argsDigest ? `${entry.argsDigest.slice(0, 15)}…` : '—'}</td>
            <td class="small">{entry.latencyMs}</td>
          </tr>
        {:else}
          <tr><td colspan="7" class="muted">No MCP activity yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
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
    margin: 0 0 0.6rem;
  }
  .lede {
    max-width: 48rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .endpoint {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
    padding: 0.8rem 1rem;
    margin-block: 1rem;
  }
  .endpoint .label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .endpoint code {
    font-size: 1rem;
    word-break: break-all;
  }
  .ways {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .way {
    padding: 1rem 1.1rem;
    min-width: 0;
  }
  .snippet-label {
    margin: 0.8rem 0 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .snippet {
    margin: 0;
    padding: 0.6rem 0.75rem;
    overflow-x: auto;
    border-radius: var(--radius);
    background: var(--background);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    white-space: pre;
  }
  .created {
    padding: 0.9rem 1rem;
    margin-block: 1rem;
    border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  }
  .created p {
    margin: 0 0 0.5rem;
  }
  .token-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .token-row code {
    word-break: break-all;
  }
  .block {
    margin-block: 1.75rem;
  }
  .create {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    gap: 0.8rem;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  .create .wide {
    grid-column: 1 / -1;
  }
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    font-weight: 400;
    align-self: end;
  }
  :global(.badge.outcome-ok) {
    color: var(--ok);
  }
  :global(.badge.outcome-denied),
  :global(.badge.outcome-error) {
    color: var(--destructive);
  }
</style>
