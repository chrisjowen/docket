<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { AgentStep } from '$lib/ask/model'

  /** What the agent looked up, step by step: what it called, in which docket, for what, and what came back. */
  interface Props {
    steps: AgentStep[]
    /** A docket's name, by slug. */
    docketName: (slug: string) => string
    /** Several dockets were asked: each step names its own. */
    many: boolean
  }

  let { steps, docketName, many }: Props = $props()

  const VERBS: Record<string, string> = { docket_search: 'Searched', docket_get: 'Read', docket_ask: 'Asked', docket_ontology: 'Read the types of' }
  const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`)
</script>

<ol class="steps" data-testid="agent-steps">
  {#each steps as step, index (index)}
    <li class="step {step.state}" data-testid="agent-step" data-tool={step.tool} data-state={step.state}>
      <span class="dot" aria-hidden="true"></span>
      <span class="what">
        <b>{VERBS[step.tool] ?? step.tool}</b>
        {#if many && step.workspace}<span class="muted">{docketName(step.workspace)}</span>{/if}
        {#if step.input}<span class="input">“{step.input}”</span>{/if}
      </span>
      <span class="result mono">
        {#if step.state === 'running'}looking…{:else}{step.result}{#if step.ms} · {seconds(step.ms)}{/if}{/if}
      </span>
    </li>
  {/each}
</ol>

<style>
  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
  }
  .step {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: baseline;
    padding: 5px 0;
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    transform: translateY(-1px);
  }
  .running .dot {
    background: var(--signal);
    animation: pulse 1s var(--ease-io) infinite alternate;
  }
  .failed .dot {
    background: var(--warn);
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 6px;
  }
  .input {
    color: var(--ink-2);
  }
  .result {
    font-size: 11.5px;
    color: var(--mute);
    text-align: right;
  }
  .failed .result {
    color: var(--warn);
  }
  @keyframes pulse {
    to {
      opacity: 0.3;
    }
  }
  @media (max-width: 640px) {
    .step {
      grid-template-columns: 12px minmax(0, 1fr);
    }
    .result {
      grid-column: 2;
      text-align: left;
    }
  }
</style>
