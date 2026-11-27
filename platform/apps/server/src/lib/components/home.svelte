<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Mail, Plus } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  interface Props {
    data: {
      user: { login: string; name: string | null; allowlisted: boolean } | null
      csrf: string | null
      orgs: { slug: string; name: string; role: string }[]
      invites: { id: string; orgName: string; orgSlug: string; role: string; invitedByLogin: string; expiresAt: string }[]
    }
    form: { problem?: string; declined?: string } | null | undefined
  }

  /** The signed-in home page: invites waiting, and the user's organisations. */
  let { data, form }: Props = $props()
  const days = (iso: string) => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000))
</script>

<svelte:head>
  <title>Docket Cloud</title>
</svelte:head>

<div class="home">
  <h1>Welcome, {data.user?.name ?? `@${data.user?.login}`}</h1>

  {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
  {#if form?.declined}<p class="flash" role="status">You declined the invite to {form.declined}.</p>{/if}

  {#if data.invites.length}
    <section>
      <h2>Invites for you</h2>
      <ul class="cards">
        {#each data.invites as invite (invite.id)}
          <li class="card invite">
            <Mail size={18} aria-hidden="true" />
            <div class="grow">
              <strong>{invite.orgName}</strong> invited you as <span class="badge">{invite.role}</span>
              <div class="muted small">from @{invite.invitedByLogin} · expires in {days(invite.expiresAt)} days</div>
            </div>
            <form method="POST" action="?/decline">
              <Csrf token={data.csrf} />
              <input type="hidden" name="invite" value={invite.id} />
              <button class="button small" type="submit">Decline</button>
            </form>
            <form method="POST" action="?/accept">
              <Csrf token={data.csrf} />
              <input type="hidden" name="invite" value={invite.id} />
              <button class="button small primary" type="submit">Accept and join {invite.orgName}</button>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section>
    <div class="row">
      <h2>Your organisations</h2>
      {#if data.user?.allowlisted}
        <a class="button primary" href={resolve('/orgs/new')}><Plus size={16} aria-hidden="true" /> New organisation</a>
      {/if}
    </div>
    {#if data.orgs.length}
      <ul class="cards">
        {#each data.orgs as org (org.slug)}
          <li>
            <a class="card org" href={resolve('/o/[org]', { org: org.slug })}>
              <span class="org-mark">{org.name.slice(0, 2).toUpperCase()}</span>
              <strong class="grow">{org.name}</strong>
              <span class="badge" class:owner={org.role === 'owner'}>{org.role}</span>
            </a>
          </li>
        {/each}
      </ul>
    {:else if data.user?.allowlisted}
      <p class="muted">You are not in an organisation yet. Create one for your team, then invite them.</p>
    {:else}
      <p class="muted">You are not in an organisation yet. Ask a team admin to invite you.</p>
    {/if}
  </section>
</div>

<style>
  .home {
    max-width: 52rem;
    margin: 0 auto;
    padding: 0.5rem 0 1rem;
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 1.5rem;
  }
  h2 {
    font-size: 1.25rem;
    margin: 0;
  }
  section {
    margin-top: 2rem;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .cards {
    list-style: none;
    padding: 0;
    margin: 1rem 0 0;
    display: grid;
    gap: 0.6rem;
  }
  .invite,
  .org {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    text-decoration: none;
    flex-wrap: wrap;
  }
  .org:hover {
    border-color: var(--gilt);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .small {
    font-size: 0.8125rem;
  }
  .org-mark {
    display: inline-grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.35rem;
    background: var(--gilt);
    color: #142019;
    font-size: 0.75rem;
    font-weight: 700;
  }
</style>
