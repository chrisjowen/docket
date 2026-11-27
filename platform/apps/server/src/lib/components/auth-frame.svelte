<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { Snippet } from 'svelte'

  import DocketMark from '$lib/components/shell/docket-mark.svelte'
  import DocketWordmark from '$lib/components/shell/docket-wordmark.svelte'

  let { pitch, children }: { pitch?: Snippet; children: Snippet } = $props()
</script>

<div class="auth">
  <section class="pitch">
    <a class="wordmark" href={resolve('/')}><DocketMark size={32} /><DocketWordmark height={20} /><span>casebook of evidence</span></a>
    <div class="pitch-body">
      {@render pitch?.()}
    </div>
    <p class="foot">{page.url.host}</p>
  </section>
  <section class="panel">
    <div class="panel-body">
      {@render children()}
    </div>
  </section>
</div>

<style>
  .auth {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    min-height: 100vh;
  }
  .pitch {
    display: flex;
    flex-direction: column;
    padding: 3.5rem;
    background: var(--spine);
    color: var(--spine-foreground);
  }
  .pitch-body {
    margin-block: auto;
    max-width: 34rem;
  }
  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    align-self: flex-start;
    text-decoration: none;
  }
  .wordmark span {
    font-family: var(--font-serif);
    font-size: 0.875rem;
    font-weight: 400;
    font-style: italic;
    color: var(--spine-muted);
  }
  .foot {
    font-size: 0.8125rem;
    color: var(--spine-muted);
  }
  .panel {
    display: flex;
    align-items: center;
    padding: 3.5rem;
    background: var(--card);
  }
  .panel-body {
    width: 100%;
    max-width: 25rem;
    margin-inline: auto;
  }
  .pitch :global(.hero) {
    font-family: var(--font-serif);
    font-size: clamp(2rem, 3.4vw, 2.75rem);
    line-height: 1.1;
    color: var(--spine-foreground);
    margin: 0 0 1rem;
  }
  .pitch :global(.lede) {
    color: var(--spine-muted);
    line-height: 1.55;
  }
  .pitch :global(.points) {
    list-style: none;
    padding: 0;
    margin: 2rem 0 0;
    display: grid;
    gap: 1rem;
  }
  .pitch :global(.points li) {
    display: flex;
    gap: 0.75rem;
    color: var(--gilt);
  }
  .pitch :global(.points strong) {
    display: block;
    font-weight: 500;
    color: var(--spine-foreground);
  }
  .pitch :global(.points span) {
    font-size: 0.875rem;
    color: var(--spine-muted);
  }
  .panel-body :global(h2) {
    font-family: var(--font-serif);
    font-size: 1.75rem;
    margin: 0 0 0.5rem;
  }
  .panel-body :global(.button.github) {
    width: 100%;
    justify-content: center;
    margin-block: 1.25rem 1rem;
    padding-block: 0.7rem;
  }
  .panel-body :global(.notice) {
    display: flex;
    gap: 0.75rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--background);
    font-size: 0.875rem;
  }
  .pitch :global(.points svg),
  .panel-body :global(.notice svg) {
    flex: none;
    margin-top: 0.2rem;
  }
  .panel-body :global(.notice p) {
    margin: 0.25rem 0 0;
    color: var(--muted-foreground);
  }
  .panel-body :global(.fine) {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    margin-top: 1rem;
  }
  @media (max-width: 760px) {
    .auth {
      grid-template-columns: minmax(0, 1fr);
    }
    .pitch,
    .panel {
      padding: 2rem 1rem;
    }
    /* On a phone, signing in comes first. */
    .panel {
      order: -1;
    }
  }
</style>
