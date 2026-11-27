<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { CAPABILITIES, CAPABILITY_INFO } from '@docket/platform-tenancy/roles'
  import { Check, Lock, Minus, Plus, Trash2 } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import OrgSettingsTabs from '$lib/components/org-settings-tabs.svelte'

  let { data, form } = $props()
  const custom = $derived(data.roles.filter((role) => !role.builtin))
  const groups = ['Content', 'Manage'] as const
</script>

<svelte:head>
  <title>Roles · {data.org.name}</title>
</svelte:head>

<h1>Settings</h1>
<OrgSettingsTabs org={data.org.slug} active="roles" />

<p class="muted lede">
  A role is a named bundle of capabilities. Someone gets a role on a place - {data.org.name} as a whole, or one docket - and
  any one grant can add or remove single capabilities for that person alone. Reader, Writer and Admin are built in and never
  change; {data.org.name}'s own roles sit beside them, and changing one changes it for everyone who holds it.
</p>

{#if form && 'problem' in form}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form && 'flash' in form}<p class="flash" role="status">{form.flash}</p>{/if}

<section class="card table-wrap">
  <table class="grid matrix" aria-label="Roles and their capabilities">
    <thead>
      <tr>
        <th>Capability</th>
        {#each data.roles as role (role.id)}
          <th>
            {role.name}
            {#if role.builtin}<Lock size={12} aria-label="built in" />{/if}
            <span class="muted small count">{role.grants} {role.grants === 1 ? 'grant' : 'grants'}</span>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each CAPABILITIES as cap (cap)}
        <tr>
          <td>{CAPABILITY_INFO[cap].label}<span class="muted small block">{CAPABILITY_INFO[cap].help}</span></td>
          {#each data.roles as role (role.id)}
            <td>
              {#if role.caps.includes(cap)}<Check size={16} aria-label="yes" class="yes" />{:else}<Minus size={16} aria-label="no" class="no" />{/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</section>

{#snippet editor(role: { id: string; name: string; description: string | null; caps: string[]; grants: number } | null)}
  <form method="POST" action="?/save" class="card role-form" data-testid={role ? `role-${role.name}` : 'new-role'}>
    <Csrf token={data.csrf} />
    {#if role}<input type="hidden" name="id" value={role.id} />{/if}
    <div class="row">
      <label>Name <input name="name" required maxlength="60" value={role?.name ?? ''} placeholder="Schema editor" /></label>
      <label class="grow">What it is for <input name="description" maxlength="200" value={role?.description ?? ''} placeholder="Writers who also publish ontology changes" /></label>
    </div>
    {#each groups as group (group)}
      <fieldset>
        <legend>{group}</legend>
        {#each CAPABILITIES.filter((cap) => CAPABILITY_INFO[cap].group === group) as cap (cap)}
          <label class="cap" title={CAPABILITY_INFO[cap].help}>
            <input type="checkbox" name="cap" value={cap} checked={role?.caps.includes(cap) ?? cap === 'read'} />
            {CAPABILITY_INFO[cap].label}
          </label>
        {/each}
      </fieldset>
    {/each}
    <div class="row">
      <button class="button primary" type="submit">{role ? 'Save' : 'Make role'}</button>
      {#if role}
        <span class="muted small">{role.grants ? `${role.grants} ${role.grants === 1 ? 'grant gives' : 'grants give'} it: saving changes them all.` : 'No one holds it yet.'}</span>
      {/if}
    </div>
  </form>
{/snippet}

{#if data.mayEdit}
  <h2>{data.org.name}'s own roles</h2>
  {#each custom as role (role.id)}
    <details class="custom" open={data.editing === role.id}>
      <summary><strong>{role.name}</strong>{#if role.description}<span class="muted small"> · {role.description}</span>{/if}</summary>
      {@render editor(role)}
      {#if role.grants === 0}
        <form method="POST" action="?/delete" class="delete">
          <Csrf token={data.csrf} />
          <input type="hidden" name="id" value={role.id} />
          <button class="button small danger" type="submit"><Trash2 size={14} aria-hidden="true" /> Delete {role.name}</button>
        </form>
      {/if}
    </details>
  {:else}
    <p class="muted">None yet.</p>
  {/each}
  <h2><Plus size={17} aria-hidden="true" /> New role</h2>
  {@render editor(null)}
{:else}
  <p class="muted small">Only an admin on the whole account changes roles.</p>
{/if}

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.35rem;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.1rem;
    margin: 1.75rem 0 0.6rem;
  }
  .lede {
    max-width: 48rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  .block,
  .count {
    display: block;
  }
  .matrix td:not(:first-child),
  .matrix th:not(:first-child) {
    text-align: center;
    min-width: 5.5rem;
  }
  .matrix :global(.yes) {
    color: var(--ok);
  }
  .matrix :global(.no) {
    color: var(--muted-foreground);
  }
  .custom {
    margin-top: 0.6rem;
  }
  .custom summary {
    cursor: pointer;
  }
  .role-form {
    padding: 1rem 1.1rem;
    display: grid;
    gap: 0.8rem;
    margin-top: 0.6rem;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: end;
    flex-wrap: wrap;
  }
  .row label {
    display: grid;
    gap: 0.25rem;
  }
  .grow {
    flex: 1;
    min-width: 12rem;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.35rem 1rem;
  }
  legend {
    font-weight: 600;
    margin-bottom: 0.35rem;
  }
  .cap {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.875rem;
  }
  .delete {
    margin-top: 0.5rem;
  }
</style>
