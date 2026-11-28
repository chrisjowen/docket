<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack } from 'svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import Steps from '$lib/components/onboarding/steps.svelte'
  import { stepNumber } from '$lib/onboarding'

  let { data, form } = $props()

  const CHOICES = [
    { value: 'reader', label: 'Reader', text: 'Everyone reads and asks every docket in General. The usual choice.' },
    { value: 'writer', label: 'Writer', text: 'Everyone also writes knowledge and proposes ontology changes there.' },
    { value: 'none', label: 'Nothing', text: 'General is only for people you give access to, one by one.' },
  ] as const

  let everyone = $state(untrack(() => (form && 'everyone' in form ? form.everyone : data.everyone)))
  const typed = untrack(() => (form && 'names' in form ? (form.names ?? []) : []))
  const others = $derived(data.spaces.filter((space) => !space.general))
</script>

<svelte:head>
  <title>Spaces · Set up {data.org.name}</title>
</svelte:head>

<div class="onboarding">
  <Steps current={stepNumber('space')} />

  <h1>Your first space: General</h1>
  <p class="lede">
    A space groups dockets for a team, a department or a client, and access given on a space covers every docket in it, including ones added later.
    {data.org.name} starts with <strong>General</strong>, where your first docket goes.
  </p>

  {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}

  <form method="POST" class="stack">
    <Csrf token={data.csrf} />
    <fieldset class="card choose">
      <legend>What everyone in {data.org.name} gets on General</legend>
      {#each CHOICES as choice (choice.value)}
        <label class="choice" class:on={everyone === choice.value}>
          <input type="radio" name="everyone" value={choice.value} bind:group={everyone} />
          <span><strong>{choice.label}</strong>{#if choice.value === 'reader'} <span class="badge">default</span>{/if}<span class="muted">{choice.text}</span></span>
        </label>
      {/each}
      <p class="muted fine">Everyone means every user of the account, never a guest and never a system account. Change it later on General's Users tab.</p>
    </fieldset>

    <fieldset class="card more">
      <legend>More spaces <span class="muted">(optional)</span></legend>
      {#if others.length}
        <p class="muted fine">Already here: {others.map((space) => space.name).join(', ')}.</p>
      {/if}
      <p class="muted fine">Name one for each team, department or client that keeps its own dockets. You can add more from Spaces + in the sidebar.</p>
      <div class="names">
        {#each Array.from({ length: data.more }, (_, index) => index) as index (index)}
          <label>
            <span class="visually-hidden">Space {index + 1}</span>
            <input name="space" maxlength="80" autocomplete="off" placeholder={['Engineering', 'Legal', 'Customers', 'Operations'][index]} value={typed[index] ?? ''} />
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="row">
      <button class="button primary" type="submit">Continue</button>
    </div>
  </form>
</div>

<style>
  .onboarding {
    max-width: 44rem;
    margin: 0 auto;
    padding: 0.5rem 0 2rem;
  }
  h1 {
    margin: 0 0 0.5rem;
  }
  fieldset {
    border: 1px solid var(--border);
    padding: 1rem 1.1rem;
    margin: 0;
    min-width: 0;
  }
  legend {
    font-weight: 600;
    padding: 0 0.3rem;
  }
  .choose {
    display: grid;
    gap: 0.5rem;
  }
  .choice {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    font-weight: 400;
  }
  .choice.on {
    border-color: var(--ink);
  }
  .choice input {
    margin-top: 0.2rem;
  }
  .choice > span {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .choice .muted {
    font-size: 0.875rem;
  }
  .names {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr));
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .names input {
    width: 100%;
  }
  .fine {
    font-size: 0.8125rem;
    margin: 0.4rem 0 0;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
