import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import { dockerComposeRuntimeSchema, type DockerComposeRuntimeConfig } from './config.js'
import { composeRuntime } from './docker-compose.js'
import { CommandNotFoundError, type CommandInvocation, type CommandOutcome, type CommandRunner } from './runner.js'

/** Records every invocation and answers from a script, so no test needs Docker. */
const fakeRunner = (answer: (invocation: CommandInvocation) => Partial<CommandOutcome> = () => ({})) => {
  const calls: CommandInvocation[] = []
  const runner: CommandRunner = async (invocation) => {
    calls.push(invocation)
    return { exitCode: 0, stdout: '', stderr: '', ...answer(invocation) }
  }
  return { calls, runner }
}

let root: string
let composeFile: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docket-runtime-'))
  composeFile = join(root, 'infra', 'docket-memory.compose.yaml')
})

const runtime = (overrides: Partial<DockerComposeRuntimeConfig> = {}, runner: CommandRunner = fakeRunner().runner) =>
  composeRuntime({
    id: 'graph-dev',
    config: dockerComposeRuntimeSchema.parse({
      provider: 'docker-compose',
      composeFile: './infra/docket-memory.compose.yaml',
      projectName: 'docket-payments',
      pullPolicy: 'never',
      services: ['graph'],
      ...overrides
    }),
    projectRoot: root,
    adapters: ['neo4j'],
    runner
  })

const base = () => ['compose', '--file', composeFile, '--project-name', 'docket-payments']

describe('docker-compose runtime up', () => {
  it.each(['never', 'missing', 'always'] as const)('passes pullPolicy %s to Compose and never builds', async (pullPolicy) => {
    const { calls, runner } = fakeRunner()
    await runtime({ pullPolicy }, runner).up()
    expect(calls).toEqual([
      {
        command: 'docker',
        args: [...base(), 'up', '--detach', '--pull', pullPolicy, '--no-build', 'graph'],
        cwd: root,
        stream: true
      }
    ])
  })

  it('starts every service in the file when none are listed', async () => {
    const { calls, runner } = fakeRunner()
    await runtime({ services: undefined }, runner).up()
    expect(calls[0]?.args).toEqual([...base(), 'up', '--detach', '--pull', 'never', '--no-build'])
  })

  it('uses an absolute composeFile as given', async () => {
    const { calls, runner } = fakeRunner()
    await runtime({ composeFile: '/srv/compose.yaml' }, runner).up()
    expect(calls[0]?.args.slice(0, 3)).toEqual(['compose', '--file', '/srv/compose.yaml'])
  })

  it('fails, starting nothing, when Compose cannot enforce the pull policy', async () => {
    const { calls, runner } = fakeRunner(() => ({ exitCode: 1, stderr: 'unknown flag: --pull' }))
    await expect(runtime({}, runner).up()).rejects.toThrow(/cannot enforce pullPolicy "never"/)
    expect(calls).toHaveLength(1)
  })

  it('reports what Compose said when up fails', async () => {
    const { runner } = fakeRunner(() => ({ exitCode: 1, stderr: 'No such image: registry.internal/neo4j:5.26' }))
    await expect(runtime({}, runner).up()).rejects.toThrow(/up exited with 1:\nNo such image: registry.internal\/neo4j:5.26/)
  })

  it('says what is missing when docker is not installed', async () => {
    const runner: CommandRunner = async () => {
      throw new CommandNotFoundError('docker')
    }
    await expect(runtime({}, runner).up()).rejects.toThrow(/docker was not found on PATH.*nothing else in docket does/)
  })
})

describe('docker-compose runtime down', () => {
  it('stops the services and keeps their volumes', async () => {
    const { calls, runner } = fakeRunner()
    await runtime({}, runner).down()
    expect(calls).toEqual([{ command: 'docker', args: ['compose', '--project-name', 'docket-payments', 'down', 'graph'], cwd: root, stream: true }])
  })

  it('deletes volumes only when asked by name', async () => {
    const { calls, runner } = fakeRunner()
    await runtime({}, runner).down({ destroyVolumes: true })
    expect(calls[0]?.args).toEqual(['compose', '--project-name', 'docket-payments', 'down', '--volumes', 'graph'])
  })
})

describe('docker-compose runtime status', () => {
  const STATUS = [
    'ps',
    '--all',
    '--filter',
    'label=com.docker.compose.project=docket-payments',
    '--format',
    '{{.Label "com.docker.compose.service"}}\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}'
  ]

  it('only lists the project\'s containers by label, needing none of the Compose file\'s variables', async () => {
    const { calls, runner } = fakeRunner(() => ({
      stdout: [
        'graph\tdocket-payments-graph-1\trunning\tUp 2 minutes (healthy)\tregistry.internal/neo4j:5.26',
        'other\tdocket-payments-other-1\texited\tExited (0) 1 hour ago\tbusybox'
      ].join('\n')
    }))
    const status = await runtime({ services: ['graph', 'vectors'] }, runner).status()

    expect(calls).toEqual([{ command: 'docker', args: STATUS, cwd: root, stream: false }])
    expect(status).toEqual({
      runtime: 'graph-dev',
      projectName: 'docket-payments',
      services: [
        {
          service: 'graph',
          state: 'running',
          health: 'healthy',
          container: 'docket-payments-graph-1',
          image: 'registry.internal/neo4j:5.26',
          status: 'Up 2 minutes (healthy)'
        },
        { service: 'vectors', state: 'not created' }
      ]
    })
  })

  it('reports every service of the project when none are listed', async () => {
    const { runner } = fakeRunner(() => ({
      stdout: 'graph\tdocket-payments-graph-1\trunning\tUp 5 seconds (health: starting)\tneo4j\nother\tdocket-payments-other-1\texited\tExited (0) 1 hour ago\tbusybox\n'
    }))
    const status = await runtime({ services: undefined }, runner).status()
    expect(status.services.map(({ service, state, health }) => ({ service, state, health }))).toEqual([
      { service: 'graph', state: 'running', health: 'starting' },
      { service: 'other', state: 'exited', health: undefined }
    ])
  })

  it('fails rather than guessing when Docker cannot list containers', async () => {
    const { runner } = fakeRunner(() => ({ exitCode: 1, stderr: 'Cannot connect to the Docker daemon' }))
    await expect(runtime({}, runner).status()).rejects.toThrow(/docker ps exited with 1:\nCannot connect to the Docker daemon/)
  })
})

describe('docker-compose runtime plan', () => {
  const RESOLVED = {
    name: 'docket-payments',
    services: {
      graph: {
        image: 'registry.internal/neo4j:5.26@sha256:abc',
        environment: { NEO4J_AUTH: 'neo4j/s3cret-value', NEO4J_PLUGINS: null },
        ports: [{ mode: 'ingress', host_ip: '127.0.0.1', target: 7687, published: '17687', protocol: 'tcp' }],
        volumes: [{ type: 'volume', source: 'graph-data', target: '/data', volume: {} }],
        command: ['neo4j', '--password=s3cret-value']
      }
    }
  }

  const withComposeFile = async (): Promise<void> => {
    await mkdir(join(root, 'infra'), { recursive: true })
    await writeFile(composeFile, 'services: {}\n')
  }

  it('describes the services and operations with every environment value redacted', async () => {
    await withComposeFile()
    const { calls, runner } = fakeRunner(() => ({ stdout: JSON.stringify(RESOLVED) }))
    const plan = await runtime({}, runner).plan()

    expect(calls).toEqual([
      { command: 'docker', args: [...base(), 'config', '--format', 'json', 'graph'], cwd: root, stream: false }
    ])
    expect(plan.problems).toEqual([])
    expect(plan.adapters).toEqual(['neo4j'])
    expect(plan.resolved).toEqual([
      {
        name: 'graph',
        image: 'registry.internal/neo4j:5.26@sha256:abc',
        ports: ['127.0.0.1:17687:7687/tcp'],
        volumes: ['graph-data:/data'],
        environment: ['NEO4J_AUTH', 'NEO4J_PLUGINS']
      }
    ])
    expect(plan.operations.up.command).toBe(
      `docker compose --file ${composeFile} --project-name docket-payments up --detach --pull never --no-build graph`
    )
    expect(plan.operations.down.command).toBe('docker compose --project-name docket-payments down graph')
    expect(plan.operations.destroyVolumes.command).toBe('docker compose --project-name docket-payments down --volumes graph')
    expect(JSON.stringify(plan)).not.toContain('s3cret-value')
  })

  it('fails without running anything when the Compose file is missing', async () => {
    const { calls, runner } = fakeRunner()
    const plan = await runtime({}, runner).plan()
    expect(calls).toEqual([])
    expect(plan.problems).toEqual([expect.stringMatching(/does not exist\. docket never writes one/)])
  })

  it('reports what Compose could not resolve', async () => {
    await withComposeFile()
    const { runner } = fakeRunner(() => ({
      exitCode: 1,
      stderr: 'required variable DOCKET_NEO4J_IMAGE is missing a value: Set the approved image reference'
    }))
    const plan = await runtime({}, runner).plan()
    expect(plan.problems).toEqual([expect.stringContaining('DOCKET_NEO4J_IMAGE is missing a value')])
    expect(plan.resolved).toEqual([])
  })

  it('flags configured services the file lacks and services with no image to run', async () => {
    await withComposeFile()
    const { runner } = fakeRunner(() => ({ stdout: JSON.stringify({ services: { graph: { build: { context: '.' } } } }) }))
    const plan = await runtime({ services: ['graph', 'vectors'] }, runner).plan()
    expect(plan.problems).toEqual([
      expect.stringContaining('Service "vectors" is not defined'),
      expect.stringContaining('Service "graph" has no image. docket runs images and never builds them')
    ])
  })
})
