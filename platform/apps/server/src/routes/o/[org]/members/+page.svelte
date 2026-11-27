<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { ACTION_LABELS, ACTIONS, ROLES, can, canChangeRole } from '@docket/platform-tenancy/roles'
  import { resolve } from '$app/paths'
  import { Check, Github, Mail, Minus, Server, UserMinus, UserPlus } from '@lucide/svelte'

  import Avatar from '$lib/components/avatar.svelte'
  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')
  const daysLeft = (iso: string | null) =>
    iso ? Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)) : 0
  const mayChange = (role: (typeof ROLES)[number]) => data.manage && canChangeRole(data.role, role, role)
</script>

<svelte:head>
  <title>Users · {data.org.name}</title>
</svelte:head>

<div class="head">
  <div>
    <h1>Users</h1>
    <p class="muted">
      The people who can see and change <strong>{data.org.name}</strong>'s dockets. Roles apply to every docket in the
      organisation. {data.seats} of {data.limit} seats used, system accounts included.
    </p>
  </div>
</div>

{#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}

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
          {#each data.assignable as role (role)}
            <option value={role} selected={role === 'editor'}>{role}</option>
          {/each}
        </select>
      </label>
      <button class="button primary" type="submit">Send invite</button>
    </form>
    <p class="muted fine">Invites expire after 7 days and work once. A GitHub invite also admits them to the beta.</p>
  </section>
{/if}

<section class="card table-wrap">
  <table class="grid" aria-label="Members">
    <thead>
      <tr><th>Member</th><th>GitHub</th><th>Role</th><th>Joined</th><th>Last active</th><th><span class="visually-hidden">Actions</span></th></tr>
    </thead>
    <tbody>
      {#each data.people as member (member.id)}
        <tr data-login={member.login}>
          <td>
            <div class="who">
              <Avatar login={member.login} name={member.name} />
              <div>
                <strong>{member.name ?? member.login}</strong>
                {#if member.email}<div class="muted small">{member.email}</div>{/if}
              </div>
            </div>
          </td>
          <td class="mono">@{member.login}</td>
          <td>
            {#if mayChange(member.role) && member.login !== data.me}
              <form method="POST" action="?/changeRole" class="inline">
                <Csrf token={data.csrf} />
                <input type="hidden" name="member" value={member.id} />
                <label class="visually-hidden" for="role-{member.id}">Role for @{member.login}</label>
                <select id="role-{member.id}" name="role" class="small">
                  {#each data.assignable as role (role)}
                    <option value={role} selected={role === member.role}>{role}</option>
                  {/each}
                </select>
                <button class="button small" type="submit">Save</button>
              </form>
            {:else}
              <span class="badge" class:owner={member.role === 'owner'} data-testid="role">{member.role}</span>
            {/if}
          </td>
          <td>{day(member.joinedAt)}</td>
          <td>{day(member.lastSeenAt)}</td>
          <td>
            {#if mayChange(member.role) && member.login !== data.me}
              <form method="POST" action="?/remove">
                <Csrf token={data.csrf} />
                <input type="hidden" name="member" value={member.id} />
                <button class="button small danger" type="submit" aria-label="Remove @{member.login}">
                  <UserMinus size={14} aria-hidden="true" />
                </button>
              </form>
            {/if}
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
      : ''}. {#if data.manage}They are made, given access and issued tokens in
      <a href={resolve('/o/[org]/settings/system-accounts', { org: data.org.slug })}>Settings › System accounts</a>.{:else}An admin makes them in Settings › System accounts.{/if}
  </span>
</p>

<h2>What each role can do</h2>
<section class="card table-wrap">
  <table class="grid matrix" aria-label="Role capabilities">
    <thead>
      <tr><th>Capability</th>{#each ROLES as role (role)}<th>{role}</th>{/each}</tr>
    </thead>
    <tbody>
      {#each ACTIONS as action (action)}
        <tr>
          <td>{ACTION_LABELS[action]}</td>
          {#each ROLES as role (role)}
            <td>
              {#if can(role, action)}
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
  .matrix :global(.yes) {
    color: var(--ok);
  }
  .matrix :global(.no) {
    color: var(--muted-foreground);
  }
</style>
