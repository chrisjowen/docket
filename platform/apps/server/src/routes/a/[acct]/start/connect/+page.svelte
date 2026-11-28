<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Bot, Check, Copy, KeyRound, LogIn } from '@lucide/svelte'

  import Steps from '$lib/components/onboarding/steps.svelte'
  import { stepNumber } from '$lib/onboarding'

  let { data } = $props()

  const snippets = $derived({
    oauth: `claude mcp add --transport http docket ${data.endpoint}`,
    token: `claude mcp add --transport http docket ${data.endpoint} \\\n  --header "Authorization: Bearer $DOCKET_TOKEN"`,
  })
  const next = $derived(`${resolve('/a/[acct]/start/invite', { acct: data.org.slug })}${data.docket ? `?docket=${encodeURIComponent(data.docket)}` : ''}`)

  let copied = $state<string | null>(null)
  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      copied = id
      setTimeout(() => (copied = null), 1500)
    } catch {
      copied = null
    }
  }
</script>

<svelte:head>
  <title>Connect an AI client · Set up {data.org.name}</title>
</svelte:head>

<div class="onboarding">
  <Steps current={stepNumber('connect')} />

  <h1>Connect an AI client</h1>
  <p class="lede">
    Claude Code, Claude Desktop, Cursor or any MCP client reads and writes {data.org.name}'s dockets through one address. An AI client always acts as
    someone - you, or a system account - and can be narrowed, never widened. There are three ways in.
  </p>

  <section class="card way" aria-labelledby="oauth-head">
    <h2 id="oauth-head"><LogIn size={17} aria-hidden="true" /> 1. Sign in from the client, as yourself <span class="badge">recommended</span></h2>
    <p class="muted">
      Add the account's address; the client opens a browser to sign in. There you <strong>name the connection</strong> ("Claude Code — work laptop"),
      choose its dockets and whether it only reads, so two of your clients can be told apart. Rename or revoke it in Your tokens &amp; connections.
    </p>
    <div class="snippet-row">
      <pre class="snippet" data-testid="oauth-snippet"><code>{snippets.oauth}</code></pre>
      <button class="button small" type="button" onclick={() => copy('oauth', snippets.oauth)}>
        {#if copied === 'oauth'}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy{/if}
      </button>
    </div>
  </section>

  <section class="card way" aria-labelledby="pat-head">
    <h2 id="pat-head"><KeyRound size={17} aria-hidden="true" /> 2. A personal access token, as yourself</h2>
    <p class="muted">
      For a client that cannot sign in. It acts as you, narrowed to read-only or some dockets if you like, and lasts up to 90 days.
      <a href={resolve('/a/[acct]/tokens', { acct: data.org.slug })}>Make one in Your tokens &amp; connections</a>, then:
    </p>
    <div class="snippet-row">
      <pre class="snippet"><code>{snippets.token}</code></pre>
      <button class="button small" type="button" onclick={() => copy('token', snippets.token)}>
        {#if copied === 'token'}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy{/if}
      </button>
    </div>
  </section>

  <section class="card way" aria-labelledby="sys-head">
    <h2 id="sys-head"><Bot size={17} aria-hidden="true" /> 3. A system account's token</h2>
    <p class="muted">
      For CI, an integration or a bot: anything that is not a person. A system account belongs to the account, has its own access, and its writes
      are its own. <a href={resolve('/a/[acct]/settings/system-accounts', { acct: data.org.slug })}>Settings › System accounts</a> is the one place
      to make one and its tokens; use them with the same command.
    </p>
  </section>

  <div class="row">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- step 6's resolved path, with the first docket -->
    <a class="button primary" href={next}>Continue</a>
  </div>
</div>

<style>
  .onboarding {
    max-width: 44rem;
    margin: 0 auto;
    padding: 0.5rem 0 2rem;
  }
  h1 {
    margin: 0 0 0.5rem;
  }
  .way {
    padding: 1rem 1.1rem;
    margin-bottom: 1rem;
    min-width: 0;
  }
  .way h2 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    font-size: 1.05rem;
    margin: 0 0 0.4rem;
  }
  .way p {
    margin: 0 0 0.6rem;
  }
  .snippet-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    min-width: 0;
  }
  .snippet {
    flex: 1;
    min-width: 0;
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
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
