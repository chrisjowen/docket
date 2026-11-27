<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { CAPABILITY_INFO, type Capability } from '@docket/platform-tenancy/roles'
  import { ShieldCheck } from '@lucide/svelte'

  import GiveAccess from '$lib/components/access/give-access.svelte'
  import GrantList from '$lib/components/access/grant-list.svelte'
  import Avatar from '$lib/components/avatar.svelte'

  let { data, form } = $props()
  const capLabel = (cap: string) => CAPABILITY_INFO[cap as Capability]?.label ?? cap
</script>

<svelte:head>
  <title>Access · {data.workspace.name}</title>
</svelte:head>

<h1>Access</h1>
<p class="muted lede">
  Access is a role on a place: on {data.org.name} as a whole, or on this docket. Everything someone is given adds up, and a
  role on the whole account covers this docket too.
</p>

{#if form && 'problem' in form}<p class="alert" role="alert">{form.problem}</p>{/if}
{#if form && 'flash' in form}<p class="flash" role="status">{form.flash}</p>{/if}

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
      <GrantList grants={data.onDocket} roles={data.roles} csrf={data.csrf} showPlace={false} label="Grants on this docket" />
    </div>
  </section>

  <GiveAccess people={data.people} places={[data.place]} roles={data.roles} csrf={data.csrf} title="Give access to {data.workspace.name}" />

  <section aria-labelledby="account-grants-title">
    <h2 id="account-grants-title" class="section">From the whole account</h2>
    <p class="muted small">
      These cover every docket in {data.org.name}, this one included. Change them on
      <a href={resolve('/o/[org]/members', { org: data.org.slug })}>Users</a>.
    </p>
    <div class="card">
      <GrantList grants={data.onAccount.map((grant) => ({ ...grant, mayChange: false }))} roles={data.roles} csrf={data.csrf} showPlace={false} label="Grants on the whole account" />
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
