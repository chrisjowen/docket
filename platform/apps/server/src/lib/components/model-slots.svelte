<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /**
   * One place's models (tenancy v2 §5): for each use, the model it runs on -
   * its own choice, or "the same as" the place above - and, where the place
   * has places inside it, which models those may choose from. Posts `<use>`
   * ('' for the place above's) and `allowed_<use>` for each model allowed.
   */
  interface Slot {
    use: string
    label: string
    help: string
    own: string
    model: string | null
    from: string
    inherited: string | null
    choices: readonly string[]
    offers: readonly string[]
    allowed: readonly string[]
  }

  let {
    slots,
    above = null,
    limitLabel = null,
    required = false,
  }: {
    slots: readonly Slot[]
    /** The place above, for "the same as": null for the account, which always chooses. */
    above?: string | null
    /** Shown over the limit checkboxes; null: this place has nothing inside it to limit. */
    limitLabel?: string | null
    required?: boolean
  } = $props()
</script>

<div class="slots">
  {#each slots as slot (slot.use)}
    <div class="slot" data-use={slot.use}>
      <label>
        <span class="name">{slot.label}</span>
        <span class="muted help">{slot.help}</span>
        <select name={slot.use} {required}>
          {#if above !== null}
            <option value="" selected={slot.own === ''}>Same as {above}{slot.inherited ? ` (${slot.inherited})` : ''}</option>
          {/if}
          {#each slot.choices as model (model)}
            <option value={model} selected={above === null ? model === slot.model : model === slot.own}>{model}</option>
          {/each}
        </select>
      </label>
      {#if slot.model === null}
        <p class="warn-text help">Nothing on the list is served by this space's key: choose another key, or ask an owner to allow a model it serves.</p>
      {:else if above !== null && slot.own !== '' && slot.own !== slot.model}
        <p class="warn-text help">{slot.own} is no longer allowed here, so {slot.model} runs.</p>
      {/if}
      {#if limitLabel && slot.offers.length > 1}
        <fieldset class="limit">
          <legend class="help">{limitLabel}</legend>
          {#each slot.offers as model (model)}
            <label class="check">
              <input type="checkbox" name="allowed_{slot.use}" value={model} checked={slot.allowed.includes(model)} />
              <span class="mono">{model}</span>
            </label>
          {/each}
          <span class="muted help">None ticked: any of these.</span>
        </fieldset>
      {/if}
    </div>
  {/each}
</div>

<style>
  .slots {
    display: grid;
    gap: 0.9rem;
    min-width: 0;
  }
  .slot {
    display: grid;
    gap: 0.4rem;
    min-width: 0;
  }
  .slot > label {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }
  .name {
    font-weight: 500;
  }
  .help {
    font-size: 0.8125rem;
  }
  select {
    max-width: 100%;
  }
  .limit {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.9rem;
    border: 1px dashed var(--rule);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    margin: 0;
    min-width: 0;
  }
  .limit legend {
    padding: 0 0.25rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.8125rem;
  }
  .warn-text {
    color: var(--warn);
    margin: 0;
  }
</style>
