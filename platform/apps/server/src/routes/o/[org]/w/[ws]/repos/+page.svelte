<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { CircleAlert, GitBranch, GitPullRequest, LoaderCircle, Plug, RefreshCw, Unplug } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()
  const ws = $derived({ org: data.org.slug, ws: data.workspace.slug })
  const busy = $derived(data.connections.some((c) => c.syncing !== null || c.exporting !== null))
  const repoChoices = $derived(data.available.flatMap((a) => a.repos.map((repo) => ({ ...repo, installationId: a.installationId }))))

  // While a sync or export is queued or running, look again every few seconds.
  $effect(() => {
    if (!busy) return
    const timer = setInterval(() => void invalidateAll(), 4_000)
    return () => clearInterval(timer)
  })

  const LINK_MESSAGES: Record<string, string> = {
    linked: 'is linked to this organisation. Connect one of its repos below.',
    'not-yours': 'Your GitHub account cannot see that installation, so it was not linked.',
    'other-account': 'GitHub authorised a different account from the one you signed in with, so nothing was linked.',
    taken: 'That installation is linked to another organisation.',
    expired: 'The install took too long or came from elsewhere. Start it again from this page.',
    unconfigured: 'Repo sync is not configured on this server.',
    github: 'GitHub did not answer as expected. Try again in a moment.',
  }
  const short = (sha: string | null) => sha?.slice(0, 7) ?? '—'
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never')
  const commitUrl = (repo: string, sha: string) => `https://github.com/${repo}/commit/${sha}`
</script>

<svelte:head>
  <title>Repos · {data.workspace.name}</title>
</svelte:head>

<h1>Repos</h1>
<p class="muted lede">
  Knowledge in {data.workspace.name} from GitHub: each connected repo's <span class="mono">.docket/</span> is synced on
  every push, as <span class="badge">repo</span> documents. A repo's <span class="mono">entities.yaml</span> is only
  ever proposed as an ontology draft. With export PRs on, knowledge written here goes back to the repo as a pull request.
</p>

{#if data.link}
  {#if data.link === 'linked'}
    <p class="flash" role="status">GitHub account <strong>{data.linkedAccount}</strong> {LINK_MESSAGES.linked}</p>
  {:else}
    <p class="alert" role="alert">{LINK_MESSAGES[data.link] ?? 'Linking the installation did not finish.'}</p>
  {/if}
{/if}
{#if form?.problem}<p class="alert pre" role="alert">{form.problem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}
{#if !data.configured}
  <p class="alert" role="note">
    Repo sync is not configured on this server yet: the GitHub App's private key and webhook secret are missing.
  </p>
{/if}

{#if data.proposed.length}
  <section class="card proposals" aria-label="Ontology drafts proposed by repos">
    <h2>Proposed by a repo</h2>
    <ul>
      {#each data.proposed as draft (draft.id)}
        <li>
          <a href="{resolve('/o/[org]/w/[ws]/ontology', ws)}?draft={draft.id}">{draft.message}</a>
          {#if draft.classification}<span class="badge {draft.classification}">{draft.classification}</span>{/if}
          <span class="muted small">{when(draft.createdAt)} · a draft until an admin publishes it</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section aria-label="Connected repos">
  <h2>Connected</h2>
  {#each data.connections as c (c.id)}
    <article class="card connection" data-repo={c.repo}>
      <header>
        <GitBranch size={18} aria-hidden="true" />
        <div class="title">
          <strong class="mono">{c.repo}</strong>
          <span class="muted mono small">@{c.branch} · {c.path}/</span>
        </div>
        {#if c.blocked}
          <span class="badge breaking">blocked</span>
        {:else if c.syncing !== null}
          <span class="badge narrowing" data-testid="sync-state"><LoaderCircle size={12} class="spin" aria-hidden="true" /> {c.syncing ? 'syncing' : 'sync queued'}</span>
        {:else if c.lastSyncError}
          <span class="badge breaking" data-testid="sync-state">sync failed</span>
        {:else if c.lastSyncSha}
          <span class="badge safe" data-testid="sync-state">in sync</span>
        {/if}
      </header>
      <dl>
        <div>
          <dt>Last sync</dt>
          <dd>
            {when(c.lastSyncAt)}
            {#if c.lastSyncSha}
              · <a class="mono" href={commitUrl(c.repo, c.lastSyncSha)} rel="external noopener" data-testid="last-commit">{short(c.lastSyncSha)}</a>
            {/if}
          </dd>
        </div>
        <div><dt>Files</dt><dd>{c.files}</dd></div>
        <div>
          <dt>Export PRs</dt>
          <dd>
            {#if c.lastExport}
              <a href={c.lastExport.url} rel="external noopener" data-testid="last-export">
                <GitPullRequest size={14} aria-hidden="true" /> #{c.lastExport.number}
              </a>
              <span class="muted small">{c.lastExport.documents} documents · {when(c.lastExport.at)}</span>
            {:else}
              {c.exportEnabled ? 'on, none yet' : 'off'}
            {/if}
            {#if c.exporting !== null}<span class="muted small">· {c.exporting ? 'opening a PR…' : 'export queued'}</span>{/if}
          </dd>
        </div>
      </dl>
      {#if c.blocked}<p class="alert">{c.blocked}</p>{/if}
      {#if c.lastSyncError && !c.blocked}<p class="alert"><CircleAlert size={14} aria-hidden="true" /> {c.lastSyncError}</p>{/if}
      {#if c.exportError}<p class="alert">Last export failed: {c.exportError}</p>{/if}
      {#if data.manage}
        <div class="actions">
          <form method="POST" action="?/resync">
            <Csrf token={data.csrf} />
            <input type="hidden" name="connection" value={c.id} />
            <button class="button small" type="submit"><RefreshCw size={14} aria-hidden="true" /> Resync now</button>
          </form>
          <form method="POST" action="?/exports" class="toggle">
            <Csrf token={data.csrf} />
            <input type="hidden" name="connection" value={c.id} />
            <label class="inline">
              <input type="checkbox" name="enabled" checked={c.exportEnabled} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
              Export PRs
            </label>
            <noscript><button class="button small" type="submit">Save</button></noscript>
          </form>
          {#if c.exportEnabled}
            <form method="POST" action="?/export">
              <Csrf token={data.csrf} />
              <input type="hidden" name="connection" value={c.id} />
              <button class="button small primary" type="submit" disabled={c.exporting !== null}>
                <GitPullRequest size={14} aria-hidden="true" /> Export cloud knowledge
              </button>
            </form>
          {/if}
          <form method="POST" action="?/disconnect" class="end">
            <Csrf token={data.csrf} />
            <input type="hidden" name="connection" value={c.id} />
            <button class="button small danger" type="submit" aria-label="Disconnect {c.repo}"><Unplug size={14} aria-hidden="true" /> Disconnect</button>
          </form>
        </div>
      {/if}
    </article>
  {:else}
    <p class="muted">No repos connected to this docket yet.</p>
  {/each}
</section>

{#if data.manage && data.configured}
  <section class="card connect" aria-label="Connect a repo">
    <h2><Plug size={16} aria-hidden="true" /> Connect a repo</h2>
    {#each data.available.filter((a) => a.error) as a (a.installationId)}
      <p class="alert">GitHub did not list {a.account}'s repos: {a.error}</p>
    {/each}
    {#if repoChoices.length}
      <form method="POST" action="?/connect" class="grid-form">
        <Csrf token={data.csrf} />
        <label class="wide">
          Repo
          <select name="repo" required>
            {#each repoChoices as repo (`${repo.installationId}:${repo.id}`)}
              <option value={`${repo.installationId}:${repo.id}`}>{repo.fullName}{repo.private ? ' (private)' : ''}</option>
            {/each}
          </select>
        </label>
        <label>
          Branch
          <input name="branch" placeholder="the default branch" autocomplete="off" />
        </label>
        <label>
          Docket directory
          <input name="path" value=".docket/" autocomplete="off" />
        </label>
        <button class="button primary" type="submit">Connect and import</button>
      </form>
    {:else if !data.installations.some((i) => i.state === 'active')}
      <p class="muted">Install the Docket Cloud GitHub App on the repos this docket should read.</p>
    {:else}
      <p class="muted">The GitHub App can read no repos yet. Give it access to one.</p>
    {/if}
    <p class="install">
      <a class="button" href={resolve('/o/[org]/w/[ws]/repos/install', ws)} data-sveltekit-reload>
        Install the GitHub App on {data.installations.length ? 'more repos' : 'your repos'}
      </a>
      <span class="muted small">
        It asks to read code and metadata, and to open pull requests for export.
        {#if data.installations.length}
          Linked: {data.installations.map((i) => `${i.account}${i.state === 'active' ? '' : ` (${i.state})`}`).join(', ')}.
        {/if}
      </span>
    </p>
  </section>
{/if}

<section aria-label="Recent syncs">
  <h2>Recent syncs</h2>
  {#if data.ingests.length}
    <div class="card table-wrap">
      <table class="grid">
        <thead>
          <tr><th>When</th><th>Repo</th><th>Commit</th><th>Changes</th><th>Notices</th></tr>
        </thead>
        <tbody>
          {#each data.ingests as ingest (ingest.id)}
            <tr data-commit={ingest.commit}>
              <td>{when(ingest.at)}</td>
              <td class="mono">{ingest.repository ?? ingest.channel}</td>
              <td>
                {#if ingest.repository && ingest.commit}
                  <a class="mono" href={commitUrl(ingest.repository, ingest.commit)} rel="external noopener">{short(ingest.commit)}</a>
                {:else}—{/if}
              </td>
              <td>
                {#if ingest.documents.length}
                  <details>
                    <summary>
                      {#if ingest.upserted}<span>+{ingest.upserted} written</span>{/if}
                      {#if ingest.retired}<span>−{ingest.retired} retired</span>{/if}
                      {#if ingest.exported}<span>{ingest.exported} exported</span>{/if}
                    </summary>
                    <ul class="list">
                      {#each ingest.documents as d, i (i)}
                        <li><span class="badge">{d.change}</span> <span class="mono">{d.resourceId}</span> <span class="muted mono small">{d.path}</span></li>
                      {/each}
                    </ul>
                  </details>
                {:else}
                  <span class="muted">no changes</span>
                {/if}
              </td>
              <td>
                {#if ingest.notices.length}
                  <ul class="list notices">
                    {#each ingest.notices as notice, i (i)}<li>{notice}</li>{/each}
                  </ul>
                {:else}<span class="muted">—</span>{/if}
                {#if ingest.draftId}
                  <a class="small" href="{resolve('/o/[org]/w/[ws]/ontology', ws)}?draft={ingest.draftId}">Review the proposed ontology</a>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="muted">Nothing synced yet.</p>
  {/if}
</section>

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.4rem;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 1.15rem;
    margin: 1.75rem 0 0.75rem;
  }
  .lede {
    max-width: 52rem;
  }
  .pre {
    white-space: pre-line;
  }
  .small {
    font-size: 0.8125rem;
  }
  section {
    max-width: 60rem;
  }
  .proposals {
    padding: 0.4rem 1.1rem 0.9rem;
    margin-top: 1.25rem;
    border-color: color-mix(in srgb, var(--gilt) 45%, var(--border));
  }
  .proposals h2 {
    margin-top: 0.6rem;
  }
  .proposals ul {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.35rem;
  }
  .connection {
    padding: 1rem 1.1rem;
    margin-bottom: 0.9rem;
    display: grid;
    gap: 0.7rem;
  }
  .connection header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  .title {
    display: grid;
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  :global(.spin) {
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.spin) {
      animation: none;
    }
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.6rem 1.2rem;
    margin: 0;
  }
  dt {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  dd {
    margin: 0.1rem 0 0;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  dd a {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .actions .button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .end {
    margin-left: auto;
  }
  .inline {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-weight: 500;
  }
  .connect {
    padding: 0.2rem 1.1rem 1.1rem;
    margin-top: 1.5rem;
  }
  .grid-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    align-items: end;
    gap: 0.75rem;
  }
  .grid-form .wide {
    grid-column: 1 / -1;
  }
  .install {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .list {
    margin: 0.4rem 0 0;
    padding-left: 1rem;
    font-size: 0.8125rem;
    max-width: 28rem;
    overflow-wrap: anywhere;
  }
  .notices {
    color: var(--muted-foreground);
  }
  @media (max-width: 640px) {
    .end {
      margin-left: 0;
    }
  }
</style>
