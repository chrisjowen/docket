<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Csrf from '$lib/components/csrf.svelte'

  /**
   * A new token: its name, when it expires, whether it only reads, and the
   * dockets it reaches - every one its owner reaches, or chosen ones. It acts
   * as its owner, so there is nothing else to choose.
   */
  let {
    csrf,
    action = '?/createToken',
    dockets,
    expiryChoices,
    defaultDays,
    owner,
    placeholder = 'Laptop scripts',
  }: {
    csrf: string | null
    action?: string
    dockets: { id: string; name: string; readOnly?: boolean }[]
    expiryChoices: number[]
    defaultDays: number
    /** Whose access it carries, as the form says it: "you", "github-sync". */
    owner: string
    placeholder?: string
  } = $props()

  let reach = $state<'all' | 'chosen'>('chosen')
</script>

<form method="POST" {action} class="card create" data-testid="token-form">
  <Csrf token={csrf} />
  <label class="wide">Name <input name="name" maxlength="200" {placeholder} required /></label>
  <label>
    Expires in
    <select name="days">
      {#each expiryChoices as days (days)}<option value={days} selected={days === defaultDays}>{days === 365 ? '1 year' : `${days} days`}</option>{/each}
    </select>
  </label>
  <label class="check">
    <input type="checkbox" name="readOnly" />
    <span>Read-only <span class="muted small">Search, read and ask; never write.</span></span>
  </label>
  <fieldset class="wide">
    <legend>Reaches</legend>
    <label class="check"><input type="radio" name="reach" value="chosen" bind:group={reach} /> <span>These dockets</span></label>
    {#if reach === 'chosen'}
      <div class="dockets">
        {#each dockets as docket, index (docket.id)}
          <label class="check">
            <input type="checkbox" name="docket" value={docket.id} checked={index === 0} />
            <span>{docket.name}{#if docket.readOnly} <span class="muted small">read only</span>{/if}</span>
          </label>
        {:else}
          <p class="muted small">{owner === 'you' ? 'You reach' : `${owner} reaches`} no docket yet.</p>
        {/each}
      </div>
    {/if}
    <label class="check"><input type="radio" name="reach" value="all" bind:group={reach} /> <span>Every docket {owner} can reach, now and later</span></label>
  </fieldset>
  <p class="muted small wide">It acts as {owner}: never more than {owner === 'you' ? 'you' : 'it'} can do, and only what you narrow it to.</p>
  <div class="wide"><button class="button primary" type="submit">Create token</button></div>
</form>

<style>
  .create {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    gap: 0.8rem;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  .wide {
    grid-column: 1 / -1;
  }
  label {
    display: grid;
    gap: 0.3rem;
  }
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    font-weight: 400;
  }
  .create > .check {
    align-self: end;
  }
  fieldset {
    display: grid;
    gap: 0.45rem;
    margin: 0;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    min-width: 0;
  }
  legend {
    padding-inline: 0.3rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .dockets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
    gap: 0.35rem 1rem;
    padding-left: 1.5rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  p {
    margin: 0;
  }
</style>
