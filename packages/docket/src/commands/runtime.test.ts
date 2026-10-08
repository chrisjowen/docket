import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { CommandInvocation, CommandRunner } from '../runtime/runner.js'
import { init } from './init.js'
import { runtimeDown, runtimePlan, runtimeStatus, runtimeUp } from './runtime.js'
import { sync } from './sync.js'

let root: string
let calls: CommandInvocation[]

const runner: CommandRunner = async (invocation) => {
  calls.push(invocation)
  return { exitCode: 0, stdout: '', stderr: '' }
}

const CONFIG = `version: 1
projections:
  - type: jsonl
    output: .docket/.index
  - type: jsonl
    output: .docket/.out
    runtime: graph-dev
runtimes:
  graph-dev:
    provider: docker-compose
    composeFile: ./infra/docket-memory.compose.yaml
    projectName: docket-payments
    services: [graph]
  vectors-dev:
    provider: docker-compose
    composeFile: ./infra/vectors.compose.yaml
    projectName: docket-vectors
`

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-runtime-command-'))
  calls = []
  await init({ cwd: root })
  await writeFile(join(root, '.docket.yaml'), CONFIG)
})

describe('docket runtime', () => {
  it('resolves the Compose file against .docket.yaml from any working directory', async () => {
    const nested = join(root, '.docket', 'notes')
    await runtimeUp('graph-dev', { cwd: nested, runner })
    expect(calls).toEqual([
      {
        command: 'docker',
        args: [
          'compose',
          '--file',
          join(root, 'infra', 'docket-memory.compose.yaml'),
          '--project-name',
          'docket-payments',
          'up',
          '--detach',
          '--pull',
          'never',
          '--no-build',
          'graph'
        ],
        cwd: root,
        stream: true
      }
    ])
  })

  it('names the adapters that connect to the runtime in its plan', async () => {
    await mkdir(join(root, 'infra'), { recursive: true })
    await writeFile(join(root, 'infra', 'docket-memory.compose.yaml'), 'services: {}\n')
    const plan = await runtimePlan('graph-dev', {
      cwd: root,
      runner: async (invocation) => {
        calls.push(invocation)
        return { exitCode: 0, stdout: '{"services":{"graph":{"image":"registry.internal/neo4j:5.26"}}}', stderr: '' }
      }
    })
    expect(plan.adapters).toEqual(['jsonl#2'])
    expect((await runtimePlan('vectors-dev', { cwd: root, runner })).adapters).toEqual([])
  })

  it('names a version 2 adapter instance by its id', async () => {
    await mkdir(join(root, 'infra'), { recursive: true })
    await writeFile(join(root, 'infra', 'docket-memory.compose.yaml'), 'services: {}\n')
    await writeFile(
      join(root, '.docket.yaml'),
      CONFIG.replace('version: 1', 'version: 2').replace(
        /projections:[\s\S]*?(?=runtimes:)/,
        'adapters:\n  - id: dev-graph\n    module: "@docket/adapter-neo4j"\n    runtime: graph-dev\n    config: { uri: "bolt://127.0.0.1:17687" }\n'
      )
    )
    const plan = await runtimePlan('graph-dev', {
      cwd: root,
      runner: async () => ({ exitCode: 0, stdout: '{"services":{}}', stderr: '' })
    })
    expect(plan.adapters).toEqual(['dev-graph'])
  })

  it('acts only on the runtime asked for', async () => {
    await runtimeStatus('vectors-dev', { cwd: root, runner })
    await runtimeDown('vectors-dev', { cwd: root, runner })
    expect(calls.map((call) => call.args.slice(0, 4))).toEqual([
      ['ps', '--all', '--filter', 'label=com.docker.compose.project=docket-vectors'],
      ['compose', '--project-name', 'docket-vectors', 'down']
    ])
  })

  it('lists the configured runtimes when asked for one that is not', async () => {
    await expect(runtimeStatus('graph', { cwd: root, runner })).rejects.toThrow(
      /No runtime "graph" in .*\.docket\.yaml\. Configured runtimes: graph-dev, vectors-dev\./
    )
    await expect(runtimePlan('constructor', { cwd: root, runner })).rejects.toThrow(
      /No runtime "constructor" in .*\.docket\.yaml\. Configured runtimes: graph-dev, vectors-dev\./
    )
    await writeFile(join(root, '.docket.yaml'), 'version: 1\n')
    await expect(runtimeStatus('graph', { cwd: root, runner })).rejects.toThrow(/It has no runtimes section/)
    expect(calls).toEqual([])
  })

  it('leaves sync to the adapters: an adapter with a runtime syncs without it, and the reference does not reproject', async () => {
    await writeFile(join(root, '.docket', 'notes', 'orders.md'), '---\nid: service.orders\ntype: service\ntitle: Orders\n---\n\nBody.\n')
    expect((await sync({ cwd: root })).upserted).toEqual(['service.orders'])

    await writeFile(join(root, '.docket.yaml'), CONFIG.replace('    runtime: graph-dev\n', ''))
    expect((await sync({ cwd: root })).unchanged).toBe(1)
  })
})
