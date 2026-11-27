<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte'
  import type { Document } from 'yaml'

  import { items, nameProblem, renameKey, setValue, type AttributeModel, type Path } from '$lib/ontology/editor'

  let {
    attributes = {},
    path,
    kinds,
    readonly,
    onedit,
    label,
  }: {
    attributes?: Record<string, AttributeModel>
    /** Where the attributes map lives in the YAML document. */
    path: Path
    kinds: string[]
    readonly: boolean
    onedit: (change: (doc: Document) => void) => void
    label: string
  } = $props()

  let adding = $state('')
  let problem = $state<string | null>(null)
  const entries = $derived(Object.entries(attributes))

  function add() {
    const name = adding.trim()
    problem = nameProblem(name, Object.keys(attributes))
    if (problem) return
    onedit((doc) => setValue(doc, [...path, name], { type: 'string' }))
    adding = ''
  }
</script>

<div class="attributes">
  {#if entries.length}
    <table class="grid" aria-label={label}>
      <thead><tr><th>Name</th><th>Kind</th><th>Allowed values</th><th>Description</th><th><span class="visually-hidden">Remove</span></th></tr></thead>
      <tbody>
        {#each entries as [name, attribute] (name)}
          <tr data-attribute={name}>
            <td>
              <input
                class="mono"
                aria-label="Name of attribute {name}"
                value={name}
                disabled={readonly}
                onchange={(e) => {
                  const to = e.currentTarget.value.trim()
                  if (to !== name && !nameProblem(to, Object.keys(attributes))) onedit((doc) => renameKey(doc, path, name, to))
                  else e.currentTarget.value = name
                }}
              />
            </td>
            <td>
              <select
                aria-label="Kind of attribute {name}"
                value={attribute.type}
                disabled={readonly}
                onchange={(e) => {
                  const value = e.currentTarget.value
                  onedit((doc) => setValue(doc, [...path, name, 'type'], value))
                }}
              >
                {#each kinds as kind (kind)}<option value={kind}>{kind}</option>{/each}
              </select>
            </td>
            <td>
              <input
                aria-label="Allowed values of attribute {name}"
                placeholder="any"
                value={(attribute.enum ?? []).join(', ')}
                disabled={readonly}
                onchange={(e) => {
                  const values = items(e.currentTarget.value, attribute.type.startsWith('number'))
                  onedit((doc) => setValue(doc, [...path, name, 'enum'], values))
                }}
              />
            </td>
            <td>
              <input
                aria-label="Description of attribute {name}"
                value={attribute.description ?? ''}
                disabled={readonly}
                onchange={(e) => {
                  const value = e.currentTarget.value.trim()
                  onedit((doc) => setValue(doc, [...path, name, 'description'], value))
                }}
              />
            </td>
            <td>
              {#if !readonly}
                <button
                  type="button"
                  class="button small danger"
                  aria-label="Remove attribute {name}"
                  onclick={() => onedit((doc) => setValue(doc, [...path, name], undefined))}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted small">No attributes.</p>
  {/if}
  {#if !readonly}
    <div class="add">
      <input aria-label="New attribute name" placeholder="new attribute" class="mono" bind:value={adding} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
      <button type="button" class="button small" onclick={add}><Plus size={13} aria-hidden="true" /> Add attribute</button>
      {#if problem}<span class="problem small" role="alert">{problem}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .attributes {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
    overflow-x: auto;
  }
  table input,
  table select {
    width: 100%;
    padding: 0.25rem 0.4rem;
    font-size: 0.8125rem;
  }
  table :global(td),
  table :global(th) {
    padding: 0.35rem 0.4rem !important;
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .add input {
    width: 12rem;
    padding: 0.25rem 0.45rem;
    font-size: 0.8125rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .problem {
    color: var(--destructive);
  }
</style>
