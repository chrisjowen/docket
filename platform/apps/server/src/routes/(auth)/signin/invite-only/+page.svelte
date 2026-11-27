<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Ticket } from '@lucide/svelte'

  import AuthFrame from '$lib/components/auth-frame.svelte'

  let { data, form } = $props()

  const SIZES = [
    { value: '1', label: 'Just me' },
    { value: '2-5', label: '2–5' },
    { value: '6-20', label: '6–20' },
    { value: '21-50', label: '21–50' },
    { value: '51+', label: '51+' },
  ]
  const values = $derived(form && 'values' in form ? form.values : null)
  const problems = $derived<Record<string, string | undefined>>((form && 'problems' in form ? form.problems : null) ?? {})
</script>

<svelte:head>
  <title>Invite-only · Docket Cloud</title>
</svelte:head>

<AuthFrame>
  {#snippet pitch()}
    <h1 class="hero">Docket Cloud is invite-only for now.</h1>
    <p class="lede">
      The beta is open to a handful of teams. Each one gets its own databases and keys, so we add teams one at a
      time.
    </p>
  {/snippet}

  <h2>Docket Cloud is invite-only for now</h2>
  {#if data.login}
    <p class="muted">
      You signed in as <strong class="mono">@{data.login}</strong>, which is not on the beta list and has no
      pending invite.
    </p>
  {:else}
    <p class="muted">Sign-in works for GitHub accounts on the beta list, or with a pending invite.</p>
  {/if}

  {#if data.onList}
    <div class="notice" role="status">
      <Ticket size={16} aria-hidden="true" />
      <div>
        <strong>You're on the waitlist</strong>
        <p>
          Thanks — we've got your GitHub login. We'll review your request and send the invite there. It usually takes a
          few days. An invite from a team admits you straight away.
        </p>
      </div>
    </div>
  {/if}

  {#if form?.sent || (data.described && !form)}
    <p class="flash" role="status">Thanks: we have your team's details{data.teamName ? ` (${data.teamName})` : ''}.</p>
  {:else if data.csrf && data.onList}
    <form method="POST" class="stack">
      <input type="hidden" name="csrf" value={data.csrf} />
      <p class="muted">Tell us about your team, so we know who to invite first.</p>
      <label>
        Email
        <input name="email" type="email" required autocomplete="email" maxlength="254" defaultValue={values?.email ?? data.email ?? ''} />
        {#if problems.email}<span class="error" role="alert">{problems.email}</span>{/if}
      </label>
      <label>
        Team name
        <input name="team" required autocomplete="organization" maxlength="120" defaultValue={values?.team ?? data.teamName ?? ''} />
        {#if problems.team}<span class="error" role="alert">{problems.team}</span>{/if}
      </label>
      <label>
        Team size
        <select name="size">
          {#each SIZES as size (size.value)}
            <option value={size.value} selected={(values?.size || data.teamSize || '2-5') === size.value}>{size.label}</option>
          {/each}
        </select>
      </label>
      <label>
        What should your assistants know first? <span class="muted">(optional)</span>
        <textarea name="note" rows="3" maxlength="1000" defaultValue={values?.note ?? ''}></textarea>
      </label>
      <button class="button primary" type="submit">Send details</button>
    </form>
  {/if}
  <p class="fine"><a href={resolve('/')}>Back to Docket Cloud</a> · <a href={resolve('/signin')}>Sign in</a></p>
</AuthFrame>

<style>
  .error {
    color: var(--destructive);
    font-size: 0.8125rem;
    font-weight: 400;
  }
</style>
