<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { invalidate } from '$app/navigation'
  import { page } from '$app/state'
  import { CAPABILITY_INFO, type Capability } from '@docket/platform-tenancy/roles'
  import { ShieldCheck } from '@lucide/svelte'

  import { ApiError, call } from '$lib/api'
  import { adjustment, givenMessage, removedMessage } from '$lib/views'
  import GiveAccess from '$platform/components/access/give-access.svelte'
  import GrantList from '$platform/components/access/grant-list.svelte'
  import type { AccessSubmit } from '$platform/components/access/submit'
  import Avatar from '$platform/components/avatar.svelte'
  import { href } from '$platform/href'

  let { data } = $props()
  const capLabel = (cap: string) => CAPABILITY_INFO[cap as Capability]?.label ?? cap

  // What the last change came to, in the words the server's page used for its form's.
  let flash = $state<string | null>(null)
  let problem = $state<string | null>(null)

  /**
   * Gives, changes or takes away a grant on this docket (`grants.create`, `grants.replace`, `grants.delete`),
   * from the forms the server's page posts to its own actions, then reads the tab again.
   */
  const submit: AccessSubmit = async (action, form) => {
    flash = null
    problem = null
    const acct = data.org.slug
    const roleId = String(form.get('role') ?? '')
    const role = data.roles.find((each) => each.id === roleId) ?? { caps: [] }
    const { add, remove } = adjustment(role, form.has('adjusted') ? form.getAll('cap').map(String) : null)
    const id = String(form.get('grant') ?? '')
    try {
      if (action === 'revoke') {
        const row = data.onDocket.find((each) => each.id === id)
        await call(fetch, 'grants.delete', { params: { acct, id } })
        flash = row ? removedMessage(row) : 'Access removed.'
      } else {
        const grant =
          action === 'give'
            ? await call(fetch, 'grants.create', { params: { acct }, body: { who: String(form.get('who') ?? ''), place: data.here.key, role: roleId, add, remove } })
            : await call(fetch, 'grants.replace', { params: { acct, id }, body: { role: roleId, add, remove } })
        flash = givenMessage(grant)
      }
      await invalidate('api:docket-access')
    } catch (cause) {
      problem = cause instanceof ApiError ? cause.message : 'The change could not be made. Try again.'
    }
  }
</script>

<svelte:head>
  <title>Access · {data.workspace.name}</title>
</svelte:head>

<h1>Access</h1>
<p class="muted lede">
  Access is a role on a place: on {data.org.name} as a whole, on a space, or on this docket. Everything someone is given adds
  up, and a role on a bigger place covers this docket too{#if data.fromSpace}: a role on {data.fromSpace.name} covers every docket in it{/if}.
</p>

{#if problem}<p class="alert" role="alert">{problem}</p>{:else if page.url.searchParams.get('problem')}
  <p class="alert" role="alert">The docket was made, but not all of its initial access could be given: {page.url.searchParams.get('problem')}</p>
{/if}
{#if flash}<p class="flash" role="status">{flash}</p>{/if}

<section class="card you" aria-labelledby="you-title" data-testid="your-access">
  <h2 id="you-title"><ShieldCheck size={17} aria-hidden="true" /> Your access here: <span class="badge">{data.you.summary}</span></h2>
  <p class="caps">{data.you.caps.map(capLabel).join(' · ')}</p>
  <p class="muted small">Because: {data.you.because.join('; ')}</p>
</section>

{#if data.manages}
  <section aria-labelledby="reach-title">
    <h2 id="reach-title" class="section">Who can reach {data.workspace.name}</h2>
    <div class="card table-wrap">
      <table class="grid stackable" aria-label="Who can reach this docket">
        <thead><tr><th>Who</th><th>Can</th><th>Because</th></tr></thead>
        <tbody>
          {#each data.reach as row (row.id)}
            <tr data-login={row.login}>
              <td data-label="Who">
                <span class="who">
                  <Avatar login={row.login} name={row.name} />
                  <span>
                    <strong>{row.name ?? row.login}</strong>
                    <span class="muted small">{row.kind === 'service' ? 'system account' : `@${row.login}`}{row.guest ? ' · guest' : ''}</span>
                  </span>
                </span>
              </td>
              <td data-label="Can">
                <span class="badge" data-testid="reach-summary">{row.summary}</span>
                {#if row.extra.length}<span class="small"> + {row.extra.map(capLabel).join(', ')}</span>{/if}
              </td>
              <td data-label="Because" class="small">{row.because.join('; ')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section aria-labelledby="docket-grants-title">
    <h2 id="docket-grants-title" class="section">Given on this docket</h2>
    <div class="card">
      <GrantList grants={data.onDocket} roles={data.roles} csrf={data.csrf} showPlace={false} label="Grants on this docket" {submit} />
    </div>
  </section>

  <GiveAccess people={data.people} places={[data.here]} roles={data.roles} csrf={data.csrf} title="Give access to {data.workspace.name}" {submit} />

  {#if data.fromSpace}
    <section aria-labelledby="space-grants-title">
      <h2 id="space-grants-title" class="section">From {data.fromSpace.name}</h2>
      <p class="muted small">
        These cover every docket in the {data.fromSpace.name} space, this one included. Change them on
        <a href={href('/o/[org]/s/[space]/access', { org: data.org.slug, space: data.fromSpace.slug })}>{data.fromSpace.name}'s access page</a>.
      </p>
      <div class="card">
        <GrantList grants={data.fromSpace.grants} roles={data.roles} csrf={data.csrf} showPlace={false} label="Grants on {data.fromSpace.name}" />
      </div>
    </section>
  {/if}

  <section aria-labelledby="account-grants-title">
    <h2 id="account-grants-title" class="section">From the whole account</h2>
    <p class="muted small">
      These cover every docket in {data.org.name}, this one included. Change them on
      <a href={href('/o/[org]/members', { org: data.org.slug })}>Users</a>.
    </p>
    <div class="card">
      <GrantList grants={data.onAccount} roles={data.roles} csrf={data.csrf} showPlace={false} label="Grants on the whole account" />
    </div>
  </section>
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
    flex-wrap: wrap;
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  h2.section {
    margin: 1.75rem 0 0.6rem;
  }
  .lede {
    max-width: 48rem;
  }
  .you {
    padding: 1rem 1.1rem;
    margin-top: 1rem;
  }
  .caps {
    margin: 0.2rem 0;
  }
  .small {
    font-size: 0.8125rem;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .who .small {
    display: block;
  }
  :global(.give) {
    margin-top: 1rem;
  }
</style>
