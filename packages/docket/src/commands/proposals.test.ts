import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorkspace } from '../mcp/local/files.js'
import { supersedeResource } from '../mcp/local/write.js'
import { loadConfig } from '../config/loader.js'
import { init } from './init.js'
import { confirmProposal, listProposals, rejectProposalCommand } from './proposals.js'

let root: string

const team = (id: string, title: string) => `---\nid: ${id}\ntype: team\ntitle: ${title}\n---\n\n${title}.\n`
const people = (me: string) => writeFile(join(root, '.docket/people.yaml'), `me: ${me}\npeople:\n  dana:\n    role: lead\n  tom: {}\n`, 'utf8')

/** Tom proposes that team.money supersedes team.payments: 0.70 of the 0.75 bar, so it is pending. */
const propose = async (now: Date) => {
  const resolved = await loadConfig(root)
  const workspace = await readWorkspace(resolved)
  const writer = { workspaceId: root, actor: 'local:tom', label: 'tom via test', channel: 'cli' as const, requestId: 'r1', principal: 'tom' }
  const result = await supersedeResource(workspace, writer, { id: 'team.payments', by: 'team.money', reason: 'Renamed.', evidence: [{ note: 'I heard so.' }] }, { now: () => now })
  return result.proposal?.id as string
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-proposals-'))
  await init({ cwd: root })
  await mkdir(join(root, '.docket/resources/teams'), { recursive: true })
  await writeFile(join(root, '.docket/resources/teams/payments.md'), team('team.payments', 'Payments'), 'utf8')
  await writeFile(join(root, '.docket/resources/teams/money.md'), team('team.money', 'Money Movement'), 'utf8')
  await people('tom')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('docket proposals', () => {
  it('lists pending proposals with their score and bar, and flags one unchanged for 30 days as stale', async () => {
    const id = await propose(new Date('2026-10-01T00:00:00.000Z'))
    expect(await listProposals({ cwd: root, now: () => new Date('2026-10-20T00:00:00.000Z') })).toEqual([
      expect.objectContaining({ id, resource: 'team.payments', supersededBy: 'team.money', status: 'pending', score: 0.7, threshold: 0.75, stale: false, evidence: 1 })
    ])
    expect(await listProposals({ cwd: root, now: () => new Date('2026-11-05T00:00:00.000Z') })).toEqual([expect.objectContaining({ id, stale: true })])
  })

  it('confirms a proposal as the person here: a lead\'s confirmation carries it, and it is listed accepted', async () => {
    const id = await propose(new Date())
    await people('dana')
    const confirmed = await confirmProposal(id.slice(0, 8), { cwd: root, note: 'Renamed in October.' })
    expect(confirmed.proposal).toMatchObject({ id, status: 'accepted', score: 0.96, threshold: 0.75 })
    expect(await listProposals({ cwd: root })).toEqual([])
    expect(await listProposals({ cwd: root, all: true })).toEqual([expect.objectContaining({ id, status: 'accepted' })])
  })

  it('records a proposal a person\'s new role carries as accepted when listed, and keeps it accepted', async () => {
    const id = await propose(new Date())
    // Tom is made a lead: his own word now clears the bar.
    await writeFile(join(root, '.docket/people.yaml'), 'me: tom\npeople:\n  tom:\n    role: lead\n', 'utf8')
    expect(await listProposals({ cwd: root, all: true })).toEqual([expect.objectContaining({ id, status: 'accepted', score: 0.85 })])
    // Accepted stays accepted, whatever the directory says later.
    await people('tom')
    expect(await listProposals({ cwd: root, all: true })).toEqual([expect.objectContaining({ id, status: 'accepted' })])
  })

  it('rejects a pending proposal with a reason, keeping it and the record, and refuses one already decided', async () => {
    const id = await propose(new Date())
    const rejected = await rejectProposalCommand(id, 'Not renamed: a second team.', { cwd: root })
    expect(rejected.proposal).toMatchObject({ id, status: 'rejected' })
    const kept = parse(await readFile(join(root, '.docket/supersessions.yaml'), 'utf8')) as { supersessions: Record<string, unknown>[] }
    expect(kept.supersessions).toEqual([expect.objectContaining({ id, status: 'rejected', rejection: 'Not renamed: a second team.', decidedBy: 'tom' })])
    expect((await rejectProposalCommand(id, 'Again.', { cwd: root })).diagnostics).toEqual([expect.objectContaining({ code: 'decided-proposal' })])
    expect((await confirmProposal(id, { cwd: root })).diagnostics).toEqual([expect.objectContaining({ code: 'rejected-proposal' })])
  })
})
