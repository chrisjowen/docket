<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { Ticket } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()

  const SIZE_LABELS: Record<string, string> = { '1': 'Just me', '2-5': '2–5', '6-20': '6–20', '21-50': '21–50', '51+': '51+' }
  const FILTERS = [
    { value: 'waiting', label: 'Waiting' },
    { value: 'invited', label: 'Invited' },
    { value: 'all', label: 'All' },
  ] as const
  const day = (iso: string) => iso.slice(0, 10)
</script>

<svelte:head>
  <title>Beta waitlist · Docket Cloud</title>
</svelte:head>

<div class="admin">
  <h1>Beta waitlist</h1>
  <p class="muted">
    Teams asking to join, newest first: {data.waiting} waiting. The beta holds {data.orgs.live} of {data.orgs.max} organisations.
  </p>
  <p class="muted small">
    <strong>Invite</strong> puts the entry's verified GitHub login on the beta list, so its next GitHub sign-in gets in and may
    create an organisation. An entry from the form has no verified GitHub account: ask its person to use <strong>Join with
    GitHub</strong> with that email as a verified address, and the entry can be invited then. Docket Cloud sends no email yet:
    tell people yourself.
  </p>

  {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
  {#if form?.invited}
    <p class="flash" role="status">
      Invited {form.invited.who}. @{form.invited.login} can sign in now.
    </p>
  {/if}

  <nav class="filters" aria-label="Show">
    {#each FILTERS as filter (filter.value)}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the resolved page, with a query -->
      <a href={`${resolve('/admin/waitlist')}?status=${filter.value}`} class="button small" class:primary={data.filter === filter.value} aria-current={data.filter === filter.value ? 'page' : undefined}
        >{filter.label}</a
      >
    {/each}
  </nav>

  <section class="card table-wrap">
    <table class="grid" aria-label="Waitlist entries">
      <thead><tr><th>Joined</th><th>Who</th><th>Team</th><th>Note</th><th>Status</th></tr></thead>
      <tbody>
        {#each data.entries as entry (entry.id)}
          <tr>
            <td class="small nowrap">{day(entry.createdAt)}<div class="muted">via {entry.via === 'github' ? 'GitHub' : 'the form'}</div></td>
            <td class="small">
              {#if entry.email}<div class="mono">{entry.email}</div>{/if}
              {#if entry.githubLogin}
                <div class="mono">@{entry.githubLogin} <span class="muted">(verified)</span></div>
              {/if}
            </td>
            <td class="small">
              {entry.teamName ?? '—'}
              {#if entry.teamSize}<div class="muted">{SIZE_LABELS[entry.teamSize] ?? entry.teamSize}</div>{/if}
            </td>
            <td class="small note">{entry.note ?? ''}</td>
            <td class="small">
              {#if entry.status === 'invited'}
                <span class="badge safe">invited</span>
                <div class="muted">{entry.invitedAt ? day(entry.invitedAt) : ''}{entry.invitedByLogin ? ` by @${entry.invitedByLogin}` : ''}</div>
              {:else if !entry.githubVerified}
                <span class="muted">needs GitHub sign-in</span>
              {:else}
                <form method="POST" action="?/invite">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="entry" value={entry.id} />
                  <button class="button small primary" type="submit" aria-label={`Invite ${entry.teamName ?? entry.email ?? `@${entry.githubLogin}`}`}>
                    <Ticket size={14} aria-hidden="true" /> Invite
                  </button>
                </form>
                {#if entry.allowlisted}<div class="muted">already on the beta list</div>{/if}
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="5" class="muted">No one here yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </section>
</div>

<style>
  .admin {
    max-width: 72rem;
    margin: 0 auto;
    padding: 0.5rem 0 1rem;
  }
  h1 {
    font-size: 2rem;
    margin: 0 0 0.35rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .nowrap {
    white-space: nowrap;
  }
  .note {
    max-width: 22rem;
    overflow-wrap: anywhere;
  }
  .filters {
    display: flex;
    gap: 0.4rem;
    margin-top: 1.25rem;
  }
  .card {
    margin-top: 1rem;
  }
  .flash,
  .alert {
    max-width: 44rem;
  }
</style>
