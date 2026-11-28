<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Bot, Database, Gauge, MailOpen, Network, Search } from '@lucide/svelte'
  import { untrack } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import Steps from '$lib/components/onboarding/steps.svelte'
  import { stepNumber } from '$lib/onboarding'

  let { data, form } = $props()

  // A refused submission comes back with what was typed; start from it.
  let name = $state(untrack(() => (form && 'name' in form ? (form.name ?? '') : '')))
  let slug = $state(untrack(() => (form && 'slug' in form ? (form.slug ?? '') : '')))
  let slugEdited = $state(untrack(() => Boolean(form && 'slug' in form && form.slug)))
  const suggested = $derived(
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40),
  )
  $effect(() => {
    if (!slugEdited) slug = suggested
  })
  const days = (iso: string) => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000))
</script>

<svelte:head>
  <title>Create your account · Docket</title>
</svelte:head>

<div class="onboarding">
  <Steps current={stepNumber('account')} />

  {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}

  {#if data.invites.length}
    <section class="invites" aria-labelledby="invites-head">
      <h2 id="invites-head"><MailOpen size={18} aria-hidden="true" /> You have an invite</h2>
      <p class="muted">Accept it to go straight into its account; there is nothing else to set up.</p>
      <ul class="cards">
        {#each data.invites as invite (invite.id)}
          <li class="card invite">
            <div class="grow">
              <strong>{invite.accountName}</strong>: <span class="badge">{invite.gives}</span>
              <div class="muted small">from @{invite.invitedBy} · expires in {days(invite.expiresAt)} days</div>
            </div>
            <form method="POST" action="?/accept">
              <Csrf token={data.csrf} />
              <input type="hidden" name="invite" value={invite.id} />
              <button class="button primary small" type="submit">Accept and join {invite.accountName}</button>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <h1>Create your account</h1>
  <p class="lede">
    An account is your company on Docket. You become its <strong>Owner</strong>: you hold every capability on all of it, pay for it, and are told when
    a system account's token is about to expire. It starts with one space, <strong>General</strong>, where your first docket goes.
  </p>

  <section class="gets" aria-labelledby="gets-head">
    <h2 id="gets-head" class="label">What the account gets</h2>
    <ul>
      <li>
        <Database size={18} aria-hidden="true" />
        <div><strong>Records in PostgreSQL</strong><span>Its own schema, database role and encryption key, on Docket's cluster: the source of truth, with history and audit.</span></div>
      </li>
      <li>
        <Network size={18} aria-hidden="true" />
        <div><strong>A graph in Neo4j</strong><span>One Neo4j instance for the account; a space may ask for its own later.</span></div>
      </li>
      <li>
        <Search size={18} aria-hidden="true" />
        <div><strong>Search in Qdrant</strong><span>A collection per docket, embedded with nomic-embed-text inside the cluster, so text never leaves it.</span></div>
      </li>
      <li>
        <Gauge size={18} aria-hidden="true" />
        <div>
          <strong>AI, capped at ${data.aiCapUsd} a month</strong><span
            >Answers, the Ask agent, graph queries and enrichment, on Docket's models. The Owner changes the cap in Settings; search never uses it.</span
          >
        </div>
      </li>
      <li>
        <Bot size={18} aria-hidden="true" />
        <div><strong>One MCP address</strong><span>Every docket the account holds, for each AI client you connect: <span class="mono">/mcp/{slug || 'your-account'}</span>.</span></div>
      </li>
    </ul>
  </section>

  {#if !data.allowlisted}
    <p class="alert" role="alert">
      Docket is invite-only for now: only people on the beta list can create an account. {data.invites.length
        ? 'Accept your invite above instead.'
        : 'Ask someone in an account to invite you.'}
    </p>
  {:else if data.full}
    <p class="alert" role="alert">The beta is full: it holds {data.limit} accounts.</p>
  {:else}
    <form method="POST" action="?/create" class="stack card create">
      <Csrf token={data.csrf} />
      <label>
        Name
        <input name="name" required maxlength="80" bind:value={name} autocomplete="organization" placeholder="Acme Corp" />
      </label>
      <label>
        Address
        <span class="slug">
          <span class="muted mono">/a/</span>
          <input
            name="slug"
            required
            maxlength="40"
            pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
            bind:value={slug}
            oninput={() => (slugEdited = true)}
          />
        </span>
        <span class="muted hint">Lowercase letters, digits and hyphens. It is in your pages' addresses and your MCP address.</span>
      </label>
      <div class="row">
        <button class="button primary" type="submit">Create account</button>
        <a class="button" href={resolve('/')}>Not now</a>
      </div>
    </form>
  {/if}
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
  h2 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.4rem;
  }
  .invites {
    margin-bottom: 2rem;
  }
  .cards {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    display: grid;
    gap: 0.6rem;
  }
  .invite {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.9rem 1rem;
  }
  .grow {
    flex: 1;
    min-width: 12rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .gets {
    margin: 1.5rem 0;
  }
  .gets ul {
    list-style: none;
    padding: 0;
    margin: 0.6rem 0 0;
    display: grid;
    gap: 0.75rem;
  }
  .gets li {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }
  .gets li > :global(svg) {
    flex: none;
    margin-top: 0.15rem;
    color: var(--muted-foreground);
  }
  .gets li div {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }
  .gets li span {
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }
  .create {
    padding: 1.25rem;
  }
  .slug {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .slug input {
    flex: 1;
    min-width: 0;
  }
  .hint {
    font-weight: 400;
    font-size: 0.8125rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
