<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { UserPlus } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  import CapabilityPicker from './capability-picker.svelte'
  import type { AccessSubmit } from './submit'

  /**
   * Gives someone a role on a place, optionally adjusted (tenancy v2 §3.1).
   * `people` is who may be chosen (with "everyone" when offered); one place
   * hides the place choice. With `submit`, the form goes to it (a page that
   * calls the API) instead of the page's `?/give` action.
   */
  let {
    people,
    places,
    roles,
    csrf,
    title = 'Give access',
    id = 'give',
    submit,
  }: {
    people: { id: string; label: string }[] | null
    places: { key: string; label: string }[]
    roles: { id: string; name: string; caps: string[] }[]
    csrf: string | null
    title?: string
    id?: string
    submit?: AccessSubmit
  } = $props()

  const onsubmit = (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    if (!submit) return
    event.preventDefault()
    void submit('give', new FormData(event.currentTarget))
  }
</script>

<form method="POST" action="?/give" class="card give" data-testid="give-access" {onsubmit}>
  <Csrf token={csrf} />
  <h2><UserPlus size={17} aria-hidden="true" /> {title}</h2>
  <div class="fields">
    {#if people}
      <label>
        Who
        <select name="who" required>
          {#each people as person (person.id)}<option value={person.id}>{person.label}</option>{/each}
        </select>
      </label>
    {/if}
    {#if places.length === 1}
      <input type="hidden" name="place" value={places[0]?.key} />
    {:else}
      <label>
        On
        <select name="place" required>
          {#each places as place (place.key)}<option value={place.key}>{place.label}</option>{/each}
        </select>
      </label>
    {/if}
    <CapabilityPicker {roles} {id} />
  </div>
  <div><button class="button primary" type="submit">Give access</button></div>
</form>

<style>
  .give {
    padding: 1rem 1.1rem;
    display: grid;
    gap: 0.8rem;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.05rem;
    margin: 0;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.75rem;
    align-items: end;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
</style>
