<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { LayoutTemplate, Trash2 } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'
  import CogneeSettings from '$lib/components/cognee-settings.svelte'
  import EnrichmentSettings from '$lib/components/enrichment-settings.svelte'
  import SettingsTabs from '$lib/components/settings-tabs.svelte'

  let { data, form } = $props()
  let confirm = $state('')

  const ROLE_LABELS: Record<string, string> = { owner: 'Owners', admin: 'Admins', editor: 'Editors' }
</script>

<svelte:head>
  <title>Settings · {data.workspace.name}</title>
</svelte:head>

<h1>Settings</h1>
<p class="muted lede">{data.workspace.name} belongs to {data.org.name}; its members' roles apply here.</p>
<SettingsTabs org={data.org.slug} ws={data.workspace.slug} active="general" />

{#if form?.ontologyProblem}<p class="alert" role="alert">{form.ontologyProblem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}

<section class="card section">
  <h2>Docket</h2>
  <dl>
    <dt>Name</dt>
    <dd>{data.workspace.name}</dd>
    <dt>Address</dt>
    <dd class="mono" data-testid="address">/o/{data.org.slug}/w/{data.workspace.slug}</dd>
    <dt>Document scope</dt>
    <dd class="mono">ws_{data.workspace.id}</dd>
    <dt>Ontology</dt>
    <dd>
      {#if data.workspace.head}
        v{data.workspace.head.number}, published by {data.workspace.head.publishedBy} · {data.workspace.head.publishedAt?.slice(0, 10)}
      {:else}
        none published
      {/if}
    </dd>
  </dl>
</section>

<form method="POST" action="?/ontologyMcp" class="card section stack mcp" data-testid="ontology-mcp">
  <Csrf token={data.csrf} />
  <h2>Ontology changes over MCP</h2>
  <p class="muted">
    MCP clients can always propose an ontology change as a draft for an admin to review. The roles ticked here can also change
    the ontology directly - publishing new versions, breaking and migrating changes included - from a token or sign-in that
    carries <span class="mono">ontology:write</span>, with no review. Every change is in the audit log and the
    <a href={resolve('/o/[org]/w/[ws]/ontology/history', { org: data.org.slug, ws: data.workspace.slug })}>ontology history</a>, where any version can be rolled back. Taking a role off stops its
    credentials from their next call.
  </p>
  <fieldset disabled={!data.ontologyMcp.canChange}>
    <legend>Roles that can change the ontology directly</legend>
    {#each data.ontologyMcp.choices as role (role)}
      <label class="choice">
        <input type="checkbox" name="role" value={role} checked={data.ontologyMcp.roles.includes(role)} />
        {ROLE_LABELS[role] ?? role}
      </label>
    {/each}
    <p class="muted fine">Viewers only ever read.</p>
  </fieldset>
  {#if data.ontologyMcp.canChange}
    <div><button class="button primary" type="submit">Save</button></div>
  {:else}
    <p class="muted fine">Only the organisation's owner changes this.</p>
  {/if}
</form>

<EnrichmentSettings
  enrichment={data.enrichment}
  csrf={data.csrf}
  canManage={data.permissions['enrichment.manage']}
  ws={{ org: data.org.slug, ws: data.workspace.slug }}
  problem={form?.enrichmentProblem}
  flash={form?.enrichmentFlash}
/>

<CogneeSettings
  cognee={data.cognee}
  csrf={data.csrf}
  canManage={data.permissions['projections.manage']}
  ws={{ org: data.org.slug, ws: data.workspace.slug }}
  problem={form?.cogneeProblem}
  flash={form?.cogneeFlash}
/>

{#if data.permissions['templates.manage']}
  <section class="card section template" aria-labelledby="template-heading" data-testid="save-template">
    <h2 id="template-heading"><LayoutTemplate size={16} aria-hidden="true" /> Save as a template</h2>
    <p class="muted">
      Saves this docket's published ontology - its record types, relationships, sources and policies, never its documents - as one
      of {data.org.name}'s templates, which New docket offers when someone starts another docket.
      <a href={resolve('/o/[org]/templates', { org: data.org.slug })}>Manage templates</a>
    </p>
    {#if form && 'templateProblem' in form}<p class="alert" role="alert">{form.templateProblem}</p>{/if}
    {#if form && 'templateFlash' in form}<p class="flash" role="status">{form.templateFlash}</p>{/if}
    {#if data.workspace.head}
      <form method="POST" action="?/saveTemplate" class="template-form">
        <Csrf token={data.csrf} />
        <label>Name <input name="name" required maxlength="80" value={data.workspace.name} /></label>
        <label>Domain tags <input name="tags" maxlength="200" placeholder="sales, customers" /></label>
        <label class="wide">Description <textarea name="description" rows="2" maxlength="500" placeholder="What a docket started from it keeps track of."></textarea></label>
        <div class="wide"><button class="button" type="submit">Save as a template</button></div>
      </form>
    {:else}
      <p class="muted fine">Publish an ontology first: a template is saved from the published one.</p>
    {/if}
  </section>
{/if}

{#if data.permissions['workspaces.delete']}
  <section class="card danger-zone" aria-labelledby="delete-heading">
    <h2 id="delete-heading"><Trash2 size={16} aria-hidden="true" /> Delete this docket</h2>
    <p class="muted">
      Deletes its {data.workspace.documents} document{data.workspace.documents === 1 ? '' : 's'} with every revision, its
      ontology, its repo connections and activity, revokes its API tokens and MCP sign-ins, and clears its graph and
      search index. The audit log keeps its events. This cannot be undone.
    </p>
    {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}
    <form method="POST" action="?/delete">
      <Csrf token={data.csrf} />
      <label>
        <span>Type <strong class="mono">{data.workspace.slug}</strong> to confirm</span>
        <input name="confirm" autocomplete="off" spellcheck="false" bind:value={confirm} />
      </label>
      <button class="button danger" type="submit" disabled={confirm.trim() !== data.workspace.slug}>Delete docket</button>
    </form>
  </section>
{/if}

<style>
  .lede {
    margin-top: 0;
  }
  .section {
    max-width: 40rem;
    padding: 1.25rem;
    margin-top: 1rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.25rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.5rem 1.25rem;
    margin: 0;
  }
  dt {
    color: var(--muted-foreground);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mcp p {
    margin: 0;
  }
  .mcp fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .mcp legend {
    font-weight: 600;
    margin-bottom: 0.4rem;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .fine {
    font-size: 0.875rem;
  }
  .danger-zone {
    margin-top: 2.5rem;
    padding: 1rem 1.1rem;
    max-width: 40rem;
    border-color: color-mix(in srgb, var(--destructive) 45%, var(--border));
  }
  .danger-zone h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 1.1rem;
    margin: 0 0 0.4rem;
    color: var(--destructive);
  }
  .danger-zone form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
  }
  .danger-zone label {
    display: grid;
    gap: 0.3rem;
    min-width: 16rem;
  }
  .template-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.7rem;
  }
  .template-form .wide {
    grid-column: 1 / -1;
  }
</style>
