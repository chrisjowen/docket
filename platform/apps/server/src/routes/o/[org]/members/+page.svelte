<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { ACTION_LABELS, ACTIONS, ROLES, can, canChangeRole } from '@docket/platform-tenancy/roles'
  import { Bot, Check, Github, Mail, Minus, UserMinus, UserPlus } from '@lucide/svelte'

  import Avatar from '$lib/components/avatar.svelte'
  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')
  const daysLeft = (iso: string | null) =>
    iso ? Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)) : 0
  const mayChange = (role: (typeof ROLES)[number]) => data.manage && canChangeRole(data.role, role, role)
</script>

<svelte:head>
  <title>Members & roles · {data.org.name}</title>
</svelte:head>

<div class="head">
  <div>
    <h1>Members & roles</h1>
    <p class="muted">
      Who can see and change <strong>{data.org.name}</strong>'s dockets. Roles apply to every docket in the
      organisation. {data.seats} of {data.limit} seats used.
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

<h2>Service accounts</h2>
<p class="muted">
  Non-human members, such as a CI bot. Their only credentials are API tokens, which never do more than their role allows. Each acts for a
  person: evidence its agents file without a source counts as that person's.
</p>
{#if data.services.length}
  <ul class="card list">
    {#each data.services as account (account.id)}
      <li data-service={account.name}>
        <Bot size={16} aria-hidden="true" />
        <div class="grow">
          <strong class="mono">{account.name}</strong>
          {#if account.description}<div class="muted small">{account.description}</div>{/if}
        </div>
        <span class="badge">{account.role}</span>
        {#if data.manage && mayChange(account.role)}
          <form method="POST" action="?/actsFor" class="acts-for">
            <Csrf token={data.csrf} />
            <input type="hidden" name="member" value={account.id} />
            <label class="muted small">
              Acts for
              <select name="person" aria-label="Who {account.name} acts for" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
                {#if !account.actsFor}<option value="" selected disabled>no one</option>{/if}
                {#each data.people as person (person.id)}
                  <option value={person.login} selected={person.login === account.actsFor}>@{person.login}</option>
                {/each}
              </select>
            </label>
            <noscript><button class="button small" type="submit">Save</button></noscript>
          </form>
        {:else}
          <span class="muted small">acts for {account.actsFor ? `@${account.actsFor}` : 'no one'}</span>
        {/if}
        <span class="muted small">added {day(account.joinedAt)}</span>
        {#if mayChange(account.role)}
          <form method="POST" action="?/remove">
            <Csrf token={data.csrf} />
            <input type="hidden" name="member" value={account.id} />
            <button class="button small danger" type="submit">Remove</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
{#if data.manage}
  <form method="POST" action="?/addService" class="card invite-form service">
    <Csrf token={data.csrf} />
    <label>
      Name
      <input name="name" required placeholder="ci-bot" pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]" maxlength="40" />
    </label>
    <label class="grow">
      What it is for <span class="muted">(optional)</span>
      <input name="description" maxlength="200" placeholder="GitHub Actions: docket cloud push on main" />
    </label>
    <label>
      Role
      <select name="role">
        {#each data.assignable.filter((role) => role !== 'owner') as role (role)}
          <option value={role} selected={role === 'viewer'}>{role}</option>
        {/each}
      </select>
    </label>
    <button class="button" type="submit"><Bot size={14} aria-hidden="true" /> Add service account</button>
  </form>
{/if}

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
  .acts-for label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .invite-form.service {
    padding: 1rem 1.25rem;
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
