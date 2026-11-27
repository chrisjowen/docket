<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { DatabaseZap, Github, Lock, ScrollText, Ticket } from '@lucide/svelte'

  import AuthFrame from '$lib/components/auth-frame.svelte'

  let { data, form } = $props()
  const query = $derived(data.next === '/' ? '' : `?next=${encodeURIComponent(data.next)}`)
</script>

<svelte:head>
  <title>Sign in · Docket Cloud</title>
</svelte:head>

<AuthFrame>
  {#snippet pitch()}
    <h1 class="hero">Your team's memory graph, with the evidence behind every claim.</h1>
    <p class="lede">
      Hosted docket for teams: a versioned ontology, Neo4j and mem0 already set up, and MCP your agents connect to
      with OAuth or scoped tokens.
    </p>
    <ul class="points">
      <li>
        <Lock size={16} aria-hidden="true" />
        <div><strong>Encrypted everywhere</strong><span>TLS on every hop; volumes and backups encrypted; a data key per organisation.</span></div>
      </li>
      <li>
        <DatabaseZap size={16} aria-hidden="true" />
        <div><strong>Your own databases</strong><span>A Postgres schema, a Neo4j database and Qdrant collections per organisation.</span></div>
      </li>
      <li>
        <ScrollText size={16} aria-hidden="true" />
        <div><strong>Every call audited</strong><span>OAuth for interactive tools, scoped tokens for CI, instant revocation.</span></div>
      </li>
    </ul>
  {/snippet}

  <h2>Sign in</h2>
  <p class="muted">Docket Cloud uses your GitHub identity. We ask for your public profile and email only.</p>
  {#if data.error}
    <p class="alert" role="alert">{data.error}</p>
  {/if}
  {#if data.githubReady}
    <!-- A link, not a form: CSP form-action would refuse the redirect on to GitHub. It is a server route, so a full page load. -->
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a class="button github" href={`${resolve('/auth/github')}${query}`} data-sveltekit-reload>
      <Github size={16} aria-hidden="true" /> Continue with GitHub
    </a>
  {:else}
    <span class="button github" aria-disabled="true"><Github size={16} aria-hidden="true" /> GitHub sign-in is not set up yet</span>
  {/if}
  {#if data.demoLogin}
    <form method="POST" action="?/demo" class="demo" data-testid="demo-signin">
      <p class="demo-title"><strong>Local preview</strong>: no password, one click.</p>
      {#if form?.demoProblem}<p class="alert" role="alert">{form.demoProblem}</p>{/if}
      <input type="hidden" name="next" value={data.next} />
      <button class="button primary" type="submit">Sign in as demo user ({data.demoLogin})</button>
    </form>
  {/if}
  <div class="notice">
    <Ticket size={16} aria-hidden="true" />
    <div>
      <strong>Invite-only for now</strong>
      <p>
        Sign-in works for GitHub accounts on the beta list, or with a pending invite from an organisation. Not
        invited? Sign in anyway and you can ask for access.
      </p>
    </div>
  </div>
  <p class="fine">By continuing you agree to the beta terms. Tokens you create are shown once and stored only as hashes.</p>
</AuthFrame>

<style>
  .demo {
    display: grid;
    gap: 0.6rem;
    margin-top: 1rem;
    padding: 0.9rem 1rem;
    border: 1px dashed var(--gilt);
    border-radius: var(--radius);
  }
  .demo-title {
    margin: 0;
    font-size: 0.875rem;
  }
</style>
