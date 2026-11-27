<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Check, Copy } from '@lucide/svelte'

  /** A token's text, shown once, right after it is made. */
  let { created }: { created: { token: string; prefix: string; expiresAt: string } } = $props()

  let copied = $state(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(created.token)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      copied = false
    }
  }
</script>

<section class="card created" data-testid="new-token">
  <p><strong>Your new token</strong> - shown once. It expires on {created.expiresAt.slice(0, 10)}.</p>
  <div class="token-row">
    <code class="mono" data-testid="token-value">{created.token}</code>
    <button class="button small" type="button" onclick={copy}>
      {#if copied}<Check size={14} aria-hidden="true" /> Copied{:else}<Copy size={14} aria-hidden="true" /> Copy{/if}
    </button>
  </div>
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
  .token-row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .token-row code {
    word-break: break-all;
  }
</style>
