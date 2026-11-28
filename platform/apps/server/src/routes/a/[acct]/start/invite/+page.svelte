<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { ArrowRight, UserPlus } from '@lucide/svelte'
  import { untrack } from 'svelte'

  import InviteLink from '$lib/components/access/invite-link.svelte'
  import Csrf from '$lib/components/csrf.svelte'
  import Steps from '$lib/components/onboarding/steps.svelte'
  import { stepNumber } from '$lib/onboarding'

  let { data, form } = $props()

  type Row = { to: string; role: string; place: string }
  const blank = (): Row => ({ to: '', role: 'writer', place: data.defaultPlace })
  const typed = untrack(() => (form && 'rows' in form ? (form.rows ?? []) : []))
  const rows: Row[] = untrack(() => Array.from({ length: data.rows }, (_, index) => typed[index] ?? blank()))
  const invited = $derived(form && 'invited' in form ? (form.invited ?? []) : [])
</script>

<svelte:head>
  <title>Invite users · Set up {data.org.name}</title>
</svelte:head>

<div class="onboarding">
  <Steps current={stepNumber(invited.length ? 'done' : 'invite')} />

  {#if invited.length}
    <h1>Invites sent</h1>
    <p class="lede">Each invite is a link that works once, for 7 days. Later invites come from <strong>Users › Invite</strong>, where you can also send one again.</p>
    {#each invited as each (each.link)}
      <InviteLink invited={each} />
    {/each}
    <div class="row">
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the first docket's Chat tab, resolved by the server -->
      <a class="button primary" href={data.done} data-testid="onboarding-done">Done: {data.firstDocket ? `open ${data.firstDocket.name}'s Chat` : `open ${data.org.name}`} <ArrowRight size={15} aria-hidden="true" /></a>
    </div>
  {:else}
    <h1>Invite users</h1>
    <p class="lede">
      One row each: their GitHub login or email, a role, and the place it is on - the whole account, a space, or one docket. Everything someone is given
      adds up, and a role on a space covers every docket in it.
    </p>

    {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}

    <form method="POST" class="card invites">
      <Csrf token={data.csrf} />
      <div class="grid" role="group" aria-label="People to invite">
        <span class="head" aria-hidden="true">GitHub login or email</span>
        <span class="head" aria-hidden="true">Role</span>
        <span class="head" aria-hidden="true">On</span>
        {#each rows as row, index (index)}
          <label class="cell who">
            <span class="small-label">Person {index + 1}: GitHub login or email</span>
            <input name="who" autocomplete="off" placeholder={index === 0 ? '@login or name@example.com' : ''} value={row.to} />
          </label>
          <label class="cell">
            <span class="small-label">Role</span>
            <select name="role">
              {#each data.roles as role (role.id)}<option value={role.id} selected={role.id === row.role}>{role.name}</option>{/each}
            </select>
          </label>
          <label class="cell">
            <span class="small-label">On</span>
            <select name="place">
              {#each data.places as place (place.key)}<option value={place.key} selected={place.key === row.place}>{place.label}</option>{/each}
            </select>
          </label>
        {/each}
      </div>
      <div class="row">
        <button class="button primary" type="submit"><UserPlus size={15} aria-hidden="true" /> Send invites</button>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the first docket's Chat tab, resolved by the server -->
        <a class="button" href={data.done} data-testid="onboarding-skip">Skip: I'm done</a>
      </div>
      <p class="muted fine">Empty rows are left out. Only the account's people reach General's dockets as everyone; a guest sees only what they are given.</p>
    </form>
  {/if}
</div>

<style>
  .onboarding {
    max-width: 50rem;
    margin: 0 auto;
    padding: 0.5rem 0 2rem;
  }
  h1 {
    margin: 0 0 0.5rem;
  }
  .invites {
    padding: 1rem 1.1rem;
    min-width: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 0.5rem 0.6rem;
    align-items: end;
  }
  .head {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .cell {
    display: grid;
    min-width: 0;
  }
  .cell input,
  .cell select {
    width: 100%;
    min-width: 0;
  }
  .small-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .fine {
    font-size: 0.8125rem;
    margin: 0.75rem 0 0;
  }
  /* On a phone each person is a card: login, then role and place side by side. */
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .head {
      display: none;
    }
    .who {
      grid-column: 1 / -1;
      margin-top: 0.6rem;
    }
    .small-label {
      position: static;
      width: auto;
      height: auto;
      clip: auto;
      font-size: 0.8125rem;
      font-weight: 600;
    }
  }
</style>
