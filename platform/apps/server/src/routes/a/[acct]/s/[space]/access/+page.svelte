<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { CAPABILITY_INFO, type Capability } from '@docket/platform-tenancy/roles'
  import { ShieldCheck, UserPlus } from '@lucide/svelte'

  import GiveAccess from '$lib/components/access/give-access.svelte'
  import GrantList from '$lib/components/access/grant-list.svelte'
  import InviteLink from '$lib/components/access/invite-link.svelte'
  import Avatar from '$lib/components/avatar.svelte'
  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()
  const capLabel = (cap: string) => CAPABILITY_INFO[cap as Capability]?.label ?? cap
</script>

<svelte:head>
  <title>Users & system accounts · {data.space.name}</title>
</svelte:head>

<p class="muted lede">
  A role on {data.space.name} covers every docket in it, including dockets added later. Everything someone is given adds up: a
  role on {data.org.name} as a whole covers this space too, and a role on one docket adds to what they have here.
  {#if data.space.general}Everyone at {data.org.name} reads General unless you change that.{/if}
</p>

{#if form && 'problem' in form}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form && 'invited' in form && form.invited}<InviteLink invited={form.invited} />{:else if form && 'flash' in form}<p class="flash" role="status">{form.flash}</p>{/if}

<section class="card you" aria-labelledby="you-title" data-testid="your-access">
  <h2 id="you-title"><ShieldCheck size={17} aria-hidden="true" /> Your access here: <span class="badge">{data.you.summary}</span></h2>
  {#if data.you.caps.length}<p class="caps">{data.you.caps.map(capLabel).join(' · ')}</p>{/if}
  <p class="muted small">
    {#if data.you.because.length}Because: {data.you.because.join('; ')}{:else}Nothing on the space itself; you may still hold access to single dockets in it.{/if}
  </p>
</section>

{#if data.manages}
  <section aria-labelledby="reach-title">
    <h2 id="reach-title" class="section">Who can reach {data.space.name}</h2>
    <div class="card table-wrap">
      <table class="grid stackable" aria-label="Who can reach this space">
        <thead><tr><th>Who</th><th>Can</th><th>Because</th></tr></thead>
        <tbody>
          {#each data.reach as row (row.id)}
            <tr data-login={row.login}>
              <td data-label="Who">
                <span class="who">
                  <Avatar login={row.login} name={row.name} />
                  <span>
                    <strong>{row.name ?? row.login}</strong>
                    <span class="muted small">{row.kind === 'service' ? 'system account' : `@${row.login}`}{row.guest ? ' · guest' : ''}</span>
                  </span>
                </span>
              </td>
              <td data-label="Can">
                <span class="badge" data-testid="reach-summary">{row.summary}</span>
                {#if row.extra.length}<span class="small"> + {row.extra.map(capLabel).join(', ')}</span>{/if}
              </td>
              <td data-label="Because" class="small">{row.because.join('; ')}</td>
            </tr>
          {:else}
            <tr><td colspan="3" class="muted">Nobody but the account's owners.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section aria-labelledby="space-grants-title">
    <h2 id="space-grants-title" class="section">Given on this space</h2>
    <div class="card">
      <GrantList grants={data.onSpace} roles={data.roles} csrf={data.csrf} showPlace={false} label="Grants on this space" />
    </div>
  </section>

  <GiveAccess people={data.people} places={[data.place]} roles={data.roles} csrf={data.csrf} title="Give access to {data.space.name}" />

  {#if data.invites}
    <section class="card invite" aria-labelledby="invite-title">
      <h2 id="invite-title"><UserPlus size={17} aria-hidden="true" /> Invite someone new to {data.space.name}</h2>
      <form method="POST" action="?/invite" class="invite-form">
        <Csrf token={data.csrf} />
        <label class="grow">
          GitHub login or email
          <input name="who" required placeholder="@login or name@example.com" autocomplete="off" />
        </label>
        <label>
          Role
          <select name="role">
            {#each data.roles as role (role.id)}
              <option value={role.id} selected={role.id === 'writer'}>{role.name}</option>
            {/each}
          </select>
        </label>
        <label class="check"><input type="checkbox" name="guest" /> Guest: sees only what they are given</label>
        <button class="button primary" type="submit">Send invite</button>
      </form>
      <p class="muted small">
        They join {data.org.name} with this role on {data.space.name}. Invites expire after 7 days and work once; see them all on
        <a href={resolve('/a/[acct]/members', { acct: data.org.slug })}>Users</a>.
      </p>
    </section>
  {/if}

  <section aria-labelledby="account-grants-title">
    <h2 id="account-grants-title" class="section">From the whole account</h2>
    <p class="muted small">
      These cover every space in {data.org.name}, this one included. Change them on
      <a href={resolve('/a/[acct]/members', { acct: data.org.slug })}>Users</a>.
    </p>
    <div class="card">
      <GrantList grants={data.onAccount} roles={data.roles} csrf={data.csrf} showPlace={false} label="Grants on the whole account" />
    </div>
  </section>
{/if}

<style>
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  h2.section {
    margin: 1.75rem 0 0.6rem;
  }
  .lede {
    max-width: 48rem;
    margin-top: 0;
  }
  .you {
    padding: 1rem 1.1rem;
    margin-top: 1rem;
  }
  .caps {
    margin: 0.2rem 0;
  }
  .small {
    font-size: 0.8125rem;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .who .small {
    display: block;
  }
  :global(.give) {
    margin-top: 1rem;
  }
  .invite {
    margin-top: 1rem;
    padding: 1rem 1.1rem;
  }
  .invite-form {
    display: flex;
    gap: 0.75rem;
    align-items: end;
    flex-wrap: wrap;
  }
  .invite-form label {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }
  .invite-form label.check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.875rem;
  }
  .grow {
    flex: 1;
    min-width: min(100%, 12rem);
  }
</style>
