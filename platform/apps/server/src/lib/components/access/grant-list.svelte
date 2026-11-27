<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { Server, Trash2, Users } from '@lucide/svelte'

  import Avatar from '$lib/components/avatar.svelte'
  import Csrf from '$lib/components/csrf.svelte'

  import CapabilityPicker from './capability-picker.svelte'

  type Grant = {
    id: string
    who: { kind: 'user' | 'everyone'; id: string | null; login: string | null; name: string | null; userKind: 'human' | 'service' | null; guest: boolean }
    place: { key: string; kind: 'account' | 'space' | 'docket'; label: string }
    role: { id: string; name: string }
    caps: string[]
    label: string
    grantedBy: string | null
    mayChange: boolean
  }

  /** Grants as rows: who, which role on which place, and - for whoever may - adjust and remove. */
  let {
    grants,
    roles,
    csrf,
    showWho = true,
    showPlace = true,
    label,
  }: {
    grants: Grant[]
    roles: { id: string; name: string; caps: string[] }[]
    csrf: string | null
    showWho?: boolean
    showPlace?: boolean
    label: string
  } = $props()
</script>

<ul class="grants" aria-label={label}>
  {#each grants as grant (grant.id)}
    <li data-grant={grant.id} data-who={grant.who.login ?? 'everyone'} data-place={grant.place.key}>
      <div class="line">
        {#if showWho}
          <span class="who">
            {#if grant.who.kind === 'everyone'}
              <span class="icon"><Users size={15} aria-hidden="true" /></span><strong>{grant.who.name}</strong>
            {:else if grant.who.userKind === 'service'}
              <span class="icon"><Server size={15} aria-hidden="true" /></span><strong class="mono">{grant.who.login}</strong><span class="muted small">system account</span>
            {:else}
              <Avatar login={grant.who.login ?? ''} name={grant.who.name} />
              <strong>{grant.who.name ?? grant.who.login}</strong>
              {#if grant.who.guest}<span class="badge">guest</span>{/if}
            {/if}
          </span>
        {/if}
        <span class="what"><span class="badge role" data-testid="grant-label">{grant.label}</span>{#if showPlace}<span class="muted small"> on {grant.place.label}</span>{/if}</span>
        {#if grant.mayChange}
          <form method="POST" action="?/revoke" class="remove">
            <Csrf token={csrf} />
            <input type="hidden" name="grant" value={grant.id} />
            <button class="button small danger" type="submit" aria-label="Remove {grant.label} on {grant.place.label} from {grant.who.login ?? 'everyone'}">
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </form>
        {/if}
      </div>
      {#if grant.mayChange}
        <details class="edit">
          <summary>Change</summary>
          <form method="POST" action="?/adjust" class="adjust-form">
            <Csrf token={csrf} />
            <input type="hidden" name="grant" value={grant.id} />
            <CapabilityPicker {roles} role={grant.role.id} caps={grant.caps} id="g-{grant.id}" />
            <div><button class="button small primary" type="submit">Save</button></div>
          </form>
        </details>
      {/if}
    </li>
  {:else}
    <li class="muted none">None.</li>
  {/each}
</ul>

<style>
  .grants {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .grants li {
    padding: 0.65rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }
  .grants li:last-child {
    border-bottom: 0;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 12rem;
  }
  .icon {
    display: inline-flex;
    color: var(--muted-foreground);
  }
  .what {
    flex: 1;
    min-width: 10rem;
  }
  .role {
    white-space: normal;
  }
  .small {
    font-size: 0.8125rem;
  }
  .remove {
    margin-left: auto;
  }
  .edit summary {
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    margin-top: 0.3rem;
  }
  .adjust-form {
    display: grid;
    grid-template-columns: minmax(0, 16rem);
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  .none {
    font-size: 0.875rem;
  }
</style>
