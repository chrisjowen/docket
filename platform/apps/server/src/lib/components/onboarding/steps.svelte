<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Check } from '@lucide/svelte'

  import { ONBOARDING_STEPS } from '$lib/onboarding'

  /** Where someone is in signing up (tenancy v2 §6): its seven steps, done, here and to come. On a phone the row scrolls sideways. */
  let { current }: { current: number } = $props()
</script>

<nav class="steps" aria-label="Setting up your account">
  <ol>
    {#each ONBOARDING_STEPS as step, index (step.key)}
      {@const number = index + 1}
      <li class:done={number < current} class:here={number === current} aria-current={number === current ? 'step' : undefined} data-step={step.key}>
        <span class="dot" aria-hidden="true">{#if number < current}<Check size={13} />{:else}{number}{/if}</span>
        <span class="name">{step.label}</span>
        {#if number < current}<span class="visually-hidden">(done)</span>{/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .steps {
    overflow-x: auto;
    margin: 0 0 1.5rem;
    padding-bottom: 0.25rem;
    scrollbar-width: thin;
  }
  ol {
    display: flex;
    gap: 0.35rem;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: max-content;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem 0.35rem 0.4rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--muted-foreground);
    font-size: 0.8125rem;
    white-space: nowrap;
  }
  li.here {
    border-color: var(--ink);
    color: var(--ink);
    font-weight: 600;
  }
  li.done {
    color: var(--ink);
  }
  .dot {
    display: inline-grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    background: var(--muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  li.here .dot {
    background: var(--ink);
    color: var(--bg);
  }
  li.done .dot {
    background: color-mix(in srgb, var(--ok) 22%, transparent);
    color: var(--ok);
  }
</style>
