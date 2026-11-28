<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { MailOpen } from '@lucide/svelte'

  import AuthFrame from '$lib/components/auth-frame.svelte'
  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()

  const until = $derived(data.invite ? data.invite.expiresAt.slice(0, 10) : '')
  const signIn = $derived(`${resolve('/signin')}?next=${encodeURIComponent(data.next)}`)
  const STATES = {
    accepted: 'This invite has been accepted already. An invite works once.',
    declined: 'This invite was declined.',
    cancelled: 'This invite was cancelled, or sent again with a new link.',
    expired: 'This invite expired. Ask whoever invited you to send it again.',
  } as const
</script>

<svelte:head>
  <title>{data.invite ? `Invite to ${data.invite.accountName}` : 'Invite'} · Docket</title>
</svelte:head>

{#snippet body()}
  {#if !data.invite}
    <h2>This link is not an open invite</h2>
    <p class="muted">It may have been mistyped, or sent again with a new link. Ask whoever invited you for a fresh one.</p>
  {:else}
    <p class="kicker"><MailOpen size={16} aria-hidden="true" /> An invite from @{data.invite.invitedBy}</p>
    <h2>Join {data.invite.accountName}</h2>
    <p>
      You are invited as <strong>{data.invite.gives}</strong>.
      {#if data.invite.to}<span class="muted">It was sent to <span class="mono">{data.invite.to}</span>.</span>{/if}
    </p>

    {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
    {#if form?.declined}
      <p class="flash" role="status">You declined the invite to {form.declined}.</p>
    {:else if data.invite.state !== 'open'}
      <p class="alert" role="alert">{STATES[data.invite.state]}</p>
    {:else if !data.signedIn}
      <a class="button primary wide" href={signIn} data-testid="invite-signin">Sign in to accept</a>
      <p class="muted fine">Sign in with GitHub, or however this server lets you in; you come straight back here. The link works once, until {until}.</p>
    {:else if !data.invite.mine}
      <p class="alert" role="alert">This invite is for {data.invite.to}. Sign in as them to accept it.</p>
    {:else}
      <div class="answer">
        <form method="POST" action="?/accept">
          <Csrf token={data.csrf} />
          <button class="button primary" type="submit">Accept and join {data.invite.accountName}</button>
        </form>
        <form method="POST" action="?/decline">
          <Csrf token={data.csrf} />
          <button class="button" type="submit">Decline</button>
        </form>
      </div>
      <p class="muted fine">The link works once, until {until}.</p>
    {/if}
  {/if}
{/snippet}

{#if data.signedIn}
  <div class="card invite">{@render body()}</div>
{:else}
  <AuthFrame>
    {#snippet pitch()}
      <h1 class="hero">{data.invite ? `You're invited to ${data.invite.accountName}.` : 'Docket'}</h1>
      <p class="lede">A shared record of what your team knows, with the evidence behind it, that you and your AI clients can read and write.</p>
    {/snippet}
    {@render body()}
  </AuthFrame>
{/if}

<style>
  .invite {
    max-width: 34rem;
    margin: 2rem auto;
    padding: 1.5rem;
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted-foreground);
    font-size: 0.875rem;
    margin: 0 0 0.25rem;
  }
  h2 {
    margin: 0 0 0.75rem;
  }
  .answer {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .wide {
    display: inline-flex;
    margin-top: 1rem;
  }
  .fine {
    font-size: 0.8125rem;
    margin-top: 0.75rem;
  }
</style>
