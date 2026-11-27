<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { CAPABILITIES, CAPABILITY_INFO } from '@docket/platform-tenancy/roles'
  import { Check, Crown, Github, Mail, Minus, Server, UserMinus, UserPlus } from '@lucide/svelte'

  import GrantList from '$lib/components/access/grant-list.svelte'
  import Avatar from '$lib/components/avatar.svelte'
  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')
  const daysLeft = (iso: string | null) => (iso ? Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)) : 0)
  const builtin = $derived(data.roles.filter((role) => role.builtin))
</script>

<svelte:head>
  <title>Users · {data.org.name}</title>
</svelte:head>

<div class="head">
  <div>
    <h1>Users</h1>
    <p class="muted">
      The people of <strong>{data.org.name}</strong>. Access is a role on a place: on the whole account, which covers every
      docket, or on one docket. Everything someone is given adds up. {data.seats} of {data.limit} seats used, system
      accounts included.
    </p>
  </div>
</div>

{#if form && 'problem' in form}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form && 'flash' in form}<p class="flash" role="status">{form.flash}</p>{/if}

{#if data.manage}
  <section class="card invite">
    <h2><UserPlus size={18} aria-hidden="true" /> Invite to {data.org.name}</h2>
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
      <label>
        On
        <select name="place">
          {#each data.invitePlaces as place (place.key)}<option value={place.key} selected={place.key === 'space:general'}>{place.label}</option>{/each}
        </select>
      </label>
      <label class="check"><input type="checkbox" name="guest" /> Guest: sees only what they are given</label>
      <button class="button primary" type="submit">Send invite</button>
    </form>
    <p class="muted fine">Invites expire after 7 days and work once. A GitHub invite also admits them to the beta.</p>
  </section>
{/if}

<section class="card table-wrap">
  <table class="grid stackable" aria-label="Members">
    <thead>
      <tr><th>User</th><th>On the whole account</th><th>Joined</th><th>Last active</th><th><span class="visually-hidden">Actions</span></th></tr>
    </thead>
    <tbody>
      {#each data.people as member (member.id)}
        <tr data-login={member.login}>
          <td data-label="User">
            <div class="who">
              <Avatar login={member.login} name={member.name} />
              <div>
                <strong>{member.name ?? member.login}</strong>
                <div class="muted small mono">@{member.login}{#if member.email} · {member.email}{/if}</div>
              </div>
            </div>
          </td>
          <td data-label="On the whole account">
            {#if data.manageAccount && !member.owner && member.login !== data.me}
              <form method="POST" action="?/accountRole" class="inline">
                <Csrf token={data.csrf} />
                <input type="hidden" name="member" value={member.id} />
                <label class="visually-hidden" for="role-{member.id}">Role on the whole account for @{member.login}</label>
                <select id="role-{member.id}" name="role" class="small">
                  <option value="none" selected={member.accountRole === null}>None (dockets only)</option>
                  {#each data.roles as role (role.id)}
                    <option value={role.id} selected={role.id === member.accountRole}>{role.name}</option>
                  {/each}
                </select>
                <button class="button small" type="submit">Save</button>
              </form>
              {#if member.accountGrant && (member.accountGrant.add.length || member.accountGrant.remove.length)}
                <div class="small muted">{member.role}</div>
              {/if}
            {:else}
              <span class="badge" class:owner={member.owner} data-testid="role">{member.role}</span>
            {/if}
            {#if member.guest}<span class="badge">guest</span>{/if}
            {#if member.grants.some((grant) => grant.place.kind === 'docket')}
              <div class="small muted" data-testid="docket-grants">
                + {member.grants
                  .filter((grant) => grant.place.kind === 'docket')
                  .map((grant) => `${grant.label} on ${grant.place.label.replace(/ \(docket\)$/, '')}`)
                  .join('; ')}
              </div>
            {/if}
          </td>
          <td data-label="Joined">{day(member.joinedAt)}</td>
          <td data-label="Last active">{day(member.lastSeenAt)}</td>
          <td>
            <div class="actions">
            {#if data.isOwner && member.login !== data.me}
              <form method="POST" action="?/owner">
                <Csrf token={data.csrf} />
                <input type="hidden" name="member" value={member.id} />
                <input type="hidden" name="owner" value={member.owner ? 'false' : 'true'} />
                <button class="button small" type="submit" title={member.owner ? 'No longer an owner' : 'Make an owner'}>
                  <Crown size={14} aria-hidden="true" />
                  <span class="visually-hidden">{member.owner ? `@${member.login} no longer owns the account` : `Make @${member.login} an owner`}</span>
                </button>
              </form>
            {/if}
            {#if data.manageAccount && member.login !== data.me && (!member.owner || data.isOwner)}
              <form method="POST" action="?/remove">
                <Csrf token={data.csrf} />
                <input type="hidden" name="member" value={member.id} />
                <button class="button small danger" type="submit" aria-label="Remove @{member.login}">
                  <UserMinus size={14} aria-hidden="true" />
                </button>
              </form>
            {/if}
            </div>
          </td>
        </tr>
        <tr class="explain-row">
          <td colspan="5">
            <details class="explain" data-testid="explain-{member.login}">
              <summary>Explain {member.name ?? member.login}'s access</summary>
              {#if member.owner}
                <p class="small">Owns {data.org.name}: every capability on every docket, and the only one who administers the account.</p>
              {/if}
              <GrantList grants={member.grants} roles={data.roles} csrf={data.csrf} showWho={false} label="Grants of @{member.login}" />
              {#if data.everyone.length && !member.guest}
                <p class="small muted">And what everyone at {data.org.name} is given: {data.everyone.map((grant) => `${grant.label} on ${grant.place.label}`).join('; ')}.</p>
              {/if}
            </details>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

{#if data.manage}
  <h2>Pending invites</h2>
  {#if data.invites.length}
    <ul class="card list">
      {#each data.invites as invite (invite.id)}
        <li>
          {#if invite.githubLogin}
            <Github size={16} aria-hidden="true" /><strong class="mono">@{invite.githubLogin}</strong>
          {:else}
            <Mail size={16} aria-hidden="true" /><strong>{invite.email}</strong>
          {/if}
          <span class="badge">{invite.role}</span>
          <span class="small">on {invite.place}{invite.guest ? ', as a guest' : ''}</span>
          <span class="muted small grow">invited by @{invite.invitedByLogin} · {day(invite.createdAt)}</span>
          <span class="muted small">expires in {daysLeft(invite.expiresAt)} days</span>
          <form method="POST" action="?/revokeInvite">
            <Csrf token={data.csrf} />
            <input type="hidden" name="invite" value={invite.id} />
            <button class="button small danger" type="submit">Cancel</button>
          </form>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No pending invites.</p>
  {/if}
{/if}

<p class="card system-accounts">
  <Server size={16} aria-hidden="true" />
  <span>
    Anything that is not a person - CI, an integration, a bot - is a <strong>system account</strong>{data.systemAccounts
      ? ` (${data.org.name} has ${data.systemAccounts})`
      : ''}. They are made, given access and issued tokens in
    <a href={resolve('/o/[org]/settings/system-accounts', { org: data.org.slug })}>Settings › System accounts</a>.
  </span>
</p>

<h2>What each role can do</h2>
<p class="muted small">
  A role is a bundle of capabilities. Reader, Writer and Admin are built in;
  <a href={resolve('/o/[org]/settings/roles', { org: data.org.slug })}>{data.org.name}'s own roles</a> sit beside them. Any one
  grant can also add or remove single capabilities.
</p>
<section class="card table-wrap">
  <table class="grid matrix" aria-label="Role capabilities">
    <thead>
      <tr><th>Capability</th>{#each data.roles as role (role.id)}<th>{role.name}</th>{/each}</tr>
    </thead>
    <tbody>
      {#each CAPABILITIES as cap (cap)}
        <tr>
          <td>{CAPABILITY_INFO[cap].label} <span class="muted small">{CAPABILITY_INFO[cap].help}</span></td>
          {#each data.roles as role (role.id)}
            <td>
              {#if role.caps.includes(cap)}
                <Check size={16} aria-label="yes" class="yes" />
              {:else}
                <Minus size={16} aria-label="no" class="no" />
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</section>
<p class="muted small">{builtin.length} built-in roles; owners hold every capability on everything.</p>

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
    margin: 2rem 0 0.75rem;
  }
  .card {
    margin-top: 1rem;
  }
  .invite {
    padding: 1rem 1.25rem;
  }
  .invite h2 {
    margin: 0 0 0.75rem;
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
  }
  .invite-form label.check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.875rem;
  }
  .system-accounts {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.8rem 1rem;
    margin-top: 1.5rem;
  }
  .grow {
    flex: 1;
    min-width: 12rem;
  }
  .fine {
    font-size: 0.8125rem;
    margin: 0.6rem 0 0;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .inline {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
  }
  .explain-row td {
    padding-top: 0;
    border-top: 0;
  }
  .explain summary {
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .list li:last-child {
    border-bottom: 0;
  }
  .list .grow {
    min-width: 8rem;
  }
  .matrix td:not(:first-child),
  .matrix th:not(:first-child) {
    text-align: center;
    width: 6rem;
  }
  .matrix td:first-child .small {
    display: block;
  }
  .matrix :global(.yes) {
    color: var(--ok);
  }
  .matrix :global(.no) {
    color: var(--muted-foreground);
  }
</style>
