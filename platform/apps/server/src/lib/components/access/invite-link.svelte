<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Check, Copy, Link } from '@lucide/svelte'

  /** A new invite's link, shown once, right after it is made or sent again (tenancy v2 §6). */
  let { invited }: { invited: { to: string; gives: string; link: string; emailedTo: string | null; note: string } } = $props()

  let copied = $state(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(invited.link)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      copied = false
    }
  }
</script>

<section class="card created" data-testid="invite-link">
  <p><Link size={15} aria-hidden="true" /> <strong>{invited.to}</strong> is invited as {invited.gives}. {invited.note}</p>
  <div class="link-row">
    <code class="mono" data-testid="invite-link-value">{invited.link}</code>
    <button class="button small" type="button" onclick={copy}>
      {#if copied}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy link{/if}
    </button>
  </div>
  <p class="muted fine">Shown once. It works once, for 7 days; Send again makes a new one.</p>
</section>

<style>
  .created {
    padding: 0.9rem 1rem;
    margin-block: 1rem;
    border-color: color-mix(in srgb, var(--ok) 50%, transparent);
  }
  .created p {
    margin: 0 0 0.5rem;
  }
  .created p :global(svg) {
    vertical-align: -2px;
  }
  .link-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .link-row code {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .fine {
    font-size: 0.8125rem;
    margin: 0.5rem 0 0;
  }
</style>
