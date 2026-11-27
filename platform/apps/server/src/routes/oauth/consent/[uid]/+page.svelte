<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { KeyRound, Laptop, ShieldAlert, ShieldCheck } from '@lucide/svelte'

  import AuthFrame from '$lib/components/auth-frame.svelte'
  import Csrf from '$lib/components/csrf.svelte'

  let { data, form } = $props()

  // The server recorded the answer; the browser goes on to the authorization server, which sends it back to the client.
  $effect(() => {
    if (form?.continueTo) window.location.assign(form.continueTo)
  })
</script>

<svelte:head>
  <title>Allow access · Docket Cloud</title>
</svelte:head>

<AuthFrame>
  {#snippet pitch()}
    <h1 class="hero">An MCP client is asking to use your docket.</h1>
    <p class="lede">
      It gets a token for one docket only, for 15 minutes at a time, renewed for up to 30 days. It can never do
      more than your role allows, and you can revoke it at any time from the docket's MCP page.
    </p>
  {/snippet}

  {#if form?.continueTo}
    <h2>Sending you back</h2>
    <p class="muted">
      Your answer is recorded. If nothing happens,
      <!-- The authorization server's resume URL, which sends the browser on to the client: not an app route. -->
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href={form.continueTo} data-sveltekit-reload>continue to the client</a>.
    </p>
  {:else}
    <h2>Allow <span class="client">{data.client.name}</span>?</h2>

    {#if data.client.device}
      <!-- A device sign-in redirects nowhere: the terminal that showed the code collects the token. -->
      <div class="redirect" data-testid="device-sign-in">
        <Laptop size={18} aria-hidden="true" />
        <div>
          <p class="label">It will receive your authorization on</p>
          <p class="host">the device that showed you the code</p>
        </div>
      </div>
    {:else}
      <div class="redirect" class:local={data.client.localApp} data-testid="redirect-host">
        {#if data.client.localApp}
          <Laptop size={18} aria-hidden="true" />
        {:else}
          <ShieldCheck size={18} aria-hidden="true" />
        {/if}
        <div>
          <p class="label">It will receive your authorization at</p>
          <p class="host mono">{data.client.redirectHost}</p>
        </div>
      </div>
    {/if}
    {#if data.client.localApp && !data.client.device}
      <p class="alert warning" role="alert" data-testid="local-app-warning">
        <ShieldAlert size={16} aria-hidden="true" />
        <span>
          <strong>Local app.</strong> This goes to a program on your own computer, and any program there could claim
          {data.client.metadataDocument ? `to be the client described at ${data.client.metadataHost}` : 'this name'}.
          Allow it only if you just started this sign-in from your own MCP client.
        </span>
      </p>
    {/if}
    <p class="muted small">
      {#if data.client.preRegistered}
        Docket Cloud's own client for the docket CLI.
      {:else if data.client.metadataDocument}
        Identified by its metadata at <span class="mono">{data.client.metadataHost}</span>.
      {:else}
        Registered itself with this server; its name is its own claim.
      {/if}
    </p>

    {#if form?.problem}<p class="alert" role="alert">{form.problem}</p>{/if}

    {#if data.target}
      <p class="workspace">
        <KeyRound size={16} aria-hidden="true" />
        <span>
          Docket <strong>{data.target.orgName} / {data.target.workspaceName}</strong>, where you are
          <span class="badge">{data.target.role}</span>
        </span>
      </p>
      <form method="POST" action="?/approve" class="stack">
        <Csrf token={data.csrf} />
        <fieldset>
          <legend>It may</legend>
          {#each data.scopes as entry (entry.scope)}
            <label class="scope" class:disabled={!entry.allowed}>
              <input type="checkbox" name="scope" value={entry.scope} checked={entry.allowed} disabled={!entry.allowed} />
              <span>
                <span class="mono">{entry.scope}</span>
                <span class="muted">{entry.label}</span>
                {#if !entry.allowed}<span class="muted">Your role cannot grant this.</span>{/if}
              </span>
            </label>
          {:else}
            <p class="muted">The client asked for no permissions it could use here.</p>
          {/each}
        </fieldset>
        <div class="actions">
          <button class="button primary" type="submit" disabled={!data.scopes.some((entry) => entry.allowed)}>Allow</button>
          <button class="button" type="submit" formaction="?/deny">Deny</button>
        </div>
      </form>
    {:else}
      <p class="alert" role="alert">
        This client asks for a docket you do not have access to{data.resource ? ` (${data.resource})` : ''}. You can only
        deny it.
      </p>
      <form method="POST" action="?/deny">
        <Csrf token={data.csrf} />
        <button class="button" type="submit">Deny</button>
      </form>
    {/if}
  {/if}
</AuthFrame>

<style>
  .client {
    color: var(--primary);
  }
  .redirect {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin-block: 1rem 0.5rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--muted);
  }
  .redirect.local {
    border-color: color-mix(in srgb, var(--warn) 60%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .redirect .label {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .redirect .host {
    margin: 0.15rem 0 0;
    font-size: 1.15rem;
    font-weight: 600;
    word-break: break-all;
  }
  .warning {
    display: flex;
    gap: 0.5rem;
    border-color: color-mix(in srgb, var(--warn) 60%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
  .small {
    font-size: 0.8125rem;
  }
  .workspace {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  fieldset {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0.8rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  legend {
    padding-inline: 0.3rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .scope {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    font-weight: 400;
  }
  .scope > span {
    display: grid;
    gap: 0.1rem;
  }
  .scope.disabled {
    opacity: 0.6;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
  }
</style>
