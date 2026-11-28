<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { ShieldAlert, ShieldCheck } from '@lucide/svelte'

  let { data } = $props()
</script>

<svelte:head>
  <title>Audit log · {data.org.name}</title>
</svelte:head>

<h1>Audit log</h1>
<p class="muted">
  {data.full ? 'Every authenticated change and API call in this account' : 'Your own entries'}, newest first. Arguments
  are kept only as a SHA-256 digest; each entry is hash-chained to the one before it.
</p>

{#if data.request}
  <p class="muted" data-testid="request-filter">
    The audit event of request <span class="mono">{data.request}</span> ·
    <a href={resolve('/a/[org]/audit', { org: data.org.slug })}>show every event</a>
  </p>
{/if}

{#if data.verdict}
  {#if data.verdict.ok}
    <p class="flash" role="status" data-testid="chain">
      <ShieldCheck size={16} aria-hidden="true" /> Chain verified: {data.verdict.events} events, none changed or removed.
    </p>
  {:else}
    <p class="alert" role="alert" data-testid="chain">
      <ShieldAlert size={16} aria-hidden="true" /> The chain is broken at {data.verdict.brokenAt}.
    </p>
  {/if}
{/if}

<section class="card table-wrap">
  <table class="grid" aria-label="Audit events">
    <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>ms</th></tr></thead>
    <tbody>
      {#each data.events as entry (entry.id)}
        <tr>
          <td class="mono small">{entry.at.replace('T', ' ').slice(0, 19)}</td>
          <td class="mono small">{entry.actor}</td>
          <td class="mono small">{entry.action}</td>
          <td class="mono small target">{entry.target.join(', ')}</td>
          <td><span class="badge outcome-{entry.outcome}">{entry.outcome}</span></td>
          <td class="small">{entry.latencyMs}</td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No events yet.</td></tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.35rem;
  }
  .flash,
  .alert {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 44rem;
  }
  .card {
    margin-top: 1rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .target {
    max-width: 22rem;
    overflow-wrap: anywhere;
  }
  .outcome-denied,
  .outcome-error {
    color: var(--destructive);
  }
</style>
