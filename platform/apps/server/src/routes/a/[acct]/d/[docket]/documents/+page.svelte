<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { resolve } from '$app/paths'
  import { CircleAlert, FileUp, TriangleAlert } from '@lucide/svelte'

  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()
  const ws = $derived({ acct: data.org.slug, docket: data.workspace.slug })
  const errors = (list: { severity: string }[]) => list.filter((d) => d.severity === 'error').length
  const warnings = (list: { severity: string }[]) => list.filter((d) => d.severity === 'warning').length
  const withFindings = $derived(data.documents.filter((d) => d.diagnostics.length).length)
</script>

<svelte:head>
  <title>Documents · {data.workspace.name}</title>
</svelte:head>

<h1>Documents</h1>
<p class="muted lede">
  {data.workspace.name}'s canonical documents: docket Markdown, each encrypted with {data.org.name}'s data key, every
  revision kept. {data.documents.length} of {data.limit.toLocaleString("en-GB")} ·
  {#if data.workspace.head}
    checked against ontology v{data.workspace.head.number} ·
    <span data-testid="findings">{withFindings} with findings</span>
  {:else}
    no ontology published
  {/if}
</p>

{#if form?.problem}<p class="alert pre" role="alert">{form.problem}</p>{/if}
{#if form?.flash}<p class="flash" role="status">{form.flash}</p>{/if}

{#if data.write}
  <form method="POST" action="?/import" enctype="multipart/form-data" class="card upload">
    <Csrf token={data.csrf} />
    <label class="grow">
      <span><FileUp size={16} aria-hidden="true" /> Import docket files</span>
      <input type="file" name="files" multiple accept=".md,text/markdown" />
    </label>
    <button class="button" type="submit">Import</button>
    <p class="muted fine">
      Each file is stored at <span class="mono">.docket/resources/&lt;type&gt;/&lt;slug&gt;.md</span> from its
      frontmatter. A file already there becomes a new revision.
    </p>
  </form>
{/if}

{#if data.documents.length}
  <section class="card table-wrap">
    <table class="grid" aria-label="Documents">
      <thead>
        <tr><th>Resource</th><th>Type</th><th>Origin</th><th>Rev</th><th>Findings</th>{#if data.write}<th><span class="visually-hidden">Actions</span></th>{/if}</tr>
      </thead>
      <tbody>
        {#each data.documents as document (document.path)}
          <tr data-resource={document.resourceId}>
            <td>
              <a href={resolve('/a/[acct]/d/[docket]/documents/[...path]', { ...ws, path: document.path })}><strong>{document.title ?? document.resourceId}</strong></a>
              <div class="mono muted small">{document.resourceId}</div>
            </td>
            <td><span class="mono">{document.resourceType}</span></td>
            <td><span class="badge" title={document.origin === 'repo' ? 'Fix it in the repo' : undefined}>{document.origin}</span></td>
            <td>{document.revision}</td>
            <td>
              {#if document.diagnostics.length}
                <details>
                  <summary>
                    {#if errors(document.diagnostics)}<span class="err"><CircleAlert size={14} aria-hidden="true" /> {errors(document.diagnostics)}</span>{/if}
                    {#if warnings(document.diagnostics)}<span class="warn"><TriangleAlert size={14} aria-hidden="true" /> {warnings(document.diagnostics)}</span>{/if}
                  </summary>
                  <ul class="findings">
                    {#each document.diagnostics as d, i (i)}
                      <li class={d.severity}><span class="mono">{d.code}</span> {d.message}</li>
                    {/each}
                  </ul>
                </details>
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            {#if data.write}
              <td>
                <form method="POST" action="?/retire">
                  <Csrf token={data.csrf} />
                  <input type="hidden" name="path" value={document.path} />
                  <button class="button small danger" type="submit" aria-label="Retire {document.resourceId}">Retire</button>
                </form>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{:else}
  <p class="muted">No documents yet.</p>
{/if}

<style>
  h1 {
    font-size: 2rem;
    margin: 0 0 0.4rem;
  }
  .lede {
    max-width: 52rem;
  }
  .pre {
    white-space: pre-line;
  }
  .upload {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
    padding: 1rem 1.1rem;
    margin: 1.25rem 0;
    max-width: 52rem;
  }
  .upload span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .grow {
    flex: 1;
    min-width: 14rem;
  }
  .fine {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.8125rem;
  }
  .small {
    font-size: 0.8125rem;
  }
  summary {
    cursor: pointer;
    display: inline-flex;
    gap: 0.6rem;
  }
  .err,
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .err,
  .findings .error {
    color: var(--destructive);
  }
  .warn,
  .findings .warning {
    color: var(--warn);
  }
  .findings {
    margin: 0.4rem 0 0;
    padding-left: 1rem;
    font-size: 0.8125rem;
    max-width: 30rem;
  }
</style>
