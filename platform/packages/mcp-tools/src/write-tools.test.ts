// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidArgumentsError } from '@chrisjowen/docket'
import { describe, expect, it, vi } from 'vitest'

import type { CloudToolContext } from './context.js'
import { cloudTools, isWriteTool, registryFor, writeTools } from './index.js'

const VIEWER = 'https://docket.test/o/acme/w/platform/graph'
const HISTORY = 'https://docket.test/o/acme/w/platform/ontology/history'

function stubContext(overrides: Partial<CloudToolContext> = {}): CloudToolContext {
  return {
    orgId: 'orga',
    workspaceId: 'ws1',
    viewer: VIEWER,
    ontologyHistory: HISTORY,
    inTenant: vi.fn(),
    query: { search: vi.fn(), ask: vi.fn(), turn: vi.fn() },
    assertWithinCap: vi.fn(async () => undefined),
    actor: 'token:dkt_live_abcdefgh',
    userId: 'u-alice',
    writer: vi.fn(async () => ({ workspaceId: 'ws1', actor: 'token:dkt_live_abcdefgh', label: 'ci-bot (token tok_abcd…)', channel: 'mcp' as const, requestId: 'req-1' })),
    mayPublish: vi.fn(async () => true),
    audited: vi.fn(),
    ...overrides,
  }
}

const tool = (context: CloudToolContext, name: string) => {
  const found = writeTools(context).find((entry) => entry.tool.definition.name === name)
  if (!found) throw new Error(`no ${name}`)
  return found.tool
}
const call = (context: CloudToolContext, name: string, args: unknown) => tool(context, name).call(args, { source: vi.fn(), viewer: null })

describe('the write tools', () => {
  it('need docket:write, except the ontology tools, which need ontology:propose and ontology:write', () => {
    const tools = writeTools(stubContext())
    expect(tools.map((entry) => [entry.tool.definition.name, entry.scope])).toEqual([
      ['docket_remember', 'docket:write'],
      ['docket_update_notes', 'docket:write'],
      ['docket_add_evidence', 'docket:write'],
      ['docket_retire', 'docket:write'],
      ['docket_supersede', 'docket:write'],
      ['docket_propose_ontology_change', 'ontology:propose'],
      ['docket_publish_ontology_change', 'ontology:write'],
    ])
    // An editor's credential without ontology:write lists the proposal tool and not the publish one.
    const editor = Object.keys(registryFor(cloudTools(stubContext()), ['docket:read', 'docket:write', 'ontology:read', 'ontology:propose']))
    expect(editor).toContain('docket_propose_ontology_change')
    expect(editor).not.toContain('docket_publish_ontology_change')
    // A viewer's read-only credential lists none of them.
    expect(Object.keys(registryFor(cloudTools(stubContext()), ['docket:read', 'ontology:read']))).toEqual(['docket_search', 'docket_get', 'docket_ask', 'docket_ontology'])
    const all = cloudTools(stubContext())
    expect(tools.every((entry) => isWriteTool(all, entry.tool.definition.name))).toBe(true)
    expect(isWriteTool(all, 'docket_search')).toBe(false)
  })

  it('say what they do: remember is idempotent, retire destructive, supersede neither destructive nor read-only', () => {
    const byName = Object.fromEntries(writeTools(stubContext()).map((entry) => [entry.tool.definition.name, entry.tool.definition.annotations]))
    expect(byName.docket_remember).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: false })
    expect(byName.docket_update_notes).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: false })
    expect(byName.docket_retire).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    expect(byName.docket_supersede).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true })
    expect(byName.docket_propose_ontology_change).toMatchObject({ readOnlyHint: false })
    expect(byName.docket_publish_ontology_change).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it('refuse malformed arguments as invalid params, before touching the workspace', async () => {
    const context = stubContext()
    await expect(call(context, 'docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: 'code' })).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(call(context, 'docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: [{ source: 'code', session: 'mine' }] })).rejects.toThrow(
      /does not take "session"/,
    )
    await expect(call(context, 'docket_remember', { id: 'service.x', type: 'service', title: 'X', evidence: [], workspace: 'other' })).rejects.toThrow(/does not take "workspace"/)
    for (const additional_notes of [undefined, '', '   ', 123, 'x'.repeat(60001)]) {
      await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes, evidence: [{ source: 'human' }] })).rejects.toBeInstanceOf(InvalidArgumentsError)
    }
    await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes: 'New notes', evidence: 'human' })).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes: 'New notes', evidence: [], workspace: 'other' })).rejects.toThrow(/does not take "workspace"/)
    await expect(call(context, 'docket_update_notes', { id: 'service.x', additional_notes: 'New notes', evidence: [], dryRun: 'true' })).rejects.toThrow(/dryRun/)
    await expect(call(context, 'docket_retire', { id: 'service.x' })).rejects.toThrow(/reason must be a non-empty string/)
    await expect(call(context, 'docket_supersede', { id: 'agent.sophia', reason: 'Renamed.', evidence: [{ source: 'human' }] })).rejects.toThrow(/by must be a non-empty string/)
    await expect(call(context, 'docket_supersede', { id: 'agent.sophia', by: 'agent.captin', reason: 'Renamed.', evidence: 'human' })).rejects.toBeInstanceOf(InvalidArgumentsError)
    await expect(call(context, 'docket_supersede', { id: 'agent.sophia', by: 'agent.captin', reason: 'Renamed.', evidence: [], since: '2026' })).rejects.toThrow(/does not take "since"/)
    await expect(call(context, 'docket_propose_ontology_change', { patch: 'a: 1', yaml: 'version: 1' })).rejects.toThrow(/either patch or yaml/)
    await expect(call(context, 'docket_publish_ontology_change', {})).rejects.toThrow(/either patch or yaml/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', migration: [{ op: 'dropType', from: 'pod' }] })).rejects.toThrow(/migration\[0\]\.op/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', dispositions: { 'pod.x': 'ignore' } })).rejects.toThrow(/dispositions\["pod.x"\]/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', expectedHead: 1.5 })).rejects.toThrow(/expectedHead/)
    await expect(call(context, 'docket_publish_ontology_change', { patch: 'a: 1', workspace: 'other' })).rejects.toThrow(/does not take "workspace"/)
    expect(context.audited).not.toHaveBeenCalled()
  })
})
