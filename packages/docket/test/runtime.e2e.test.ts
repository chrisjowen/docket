import { execFile, spawn } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CLI, makeRepo, removeRepo, until, write, type CliResult } from './helpers.js'

const run = promisify(execFile)

/**
 * A stand-in `docker` first on PATH: it logs every invocation and answers
 * `config` and `ps` as Compose would, so the shipped CLI is exercised end to
 * end without Docker installed.
 */
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$* " in
  *" config "*) cat "$DOCKER_CONFIG_JSON" ;;
  "ps "*) printf 'graph\\tdocket-payments-graph-1\\trunning\\tUp 1 minute (healthy)\\tregistry.internal.example/neo4j:5.26\\n' ;;
esac
`

const RESOLVED = {
  services: {
    graph: {
      image: 'registry.internal.example/neo4j:5.26',
      environment: { NEO4J_AUTH: 'neo4j/never-print-me' },
      ports: [{ host_ip: '127.0.0.1', target: 7687, published: '17687', protocol: 'tcp' }],
      volumes: [{ type: 'volume', source: 'graph-data', target: '/data' }]
    }
  }
}

const CONFIG = `version: 1
projections:
  - type: jsonl
    output: .docket/.index
    runtime: graph-dev
runtimes:
  graph-dev:
    provider: docker-compose
    composeFile: ./infra/docket-memory.compose.yaml
    projectName: docket-payments
    pullPolicy: never
    services: [graph]
`

let root: string | undefined
let log: string

beforeEach(async () => {
  root = await makeRepo('docket-runtime-e2e')
  log = join(root, 'docker.log')
  await mkdir(join(root, 'bin'))
  await writeFile(join(root, 'bin', 'docker'), FAKE_DOCKER)
  await chmod(join(root, 'bin', 'docker'), 0o755)
  await writeFile(join(root, 'resolved.json'), JSON.stringify(RESOLVED))
  await writeFile(log, '')
  await writeFile(join(root, '.docket.yaml'), CONFIG)
  await write(root, 'infra/docket-memory.compose.yaml', 'services:\n  graph:\n    image: ${DOCKET_NEO4J_IMAGE:?Set the approved image reference}\n')
  await write(root, '.docket/notes/orders.md', '---\nid: service.orders\ntype: service\ntitle: Orders\n---\n\nBody.\n')
})

afterEach(async () => {
  await removeRepo(root)
  root = undefined
})

const fakeDockerEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${join(root!, 'bin')}:${process.env.PATH ?? ''}`,
  DOCKER_LOG: log,
  DOCKER_CONFIG_JSON: join(root!, 'resolved.json')
})

const docket = async (...args: string[]): Promise<CliResult> => {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd: root, env: fakeDockerEnv() })
    return { code: 0, stdout, stderr }
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const dockerCalls = async (): Promise<string[]> =>
  (await readFile(log, 'utf8')).split('\n').filter((line) => line !== '')

describe('docket runtime end to end', () => {
  it('never touches containers from validate, sync, rebuild or search', async () => {
    for (const args of [['validate'], ['sync'], ['rebuild'], ['search', 'orders']]) {
      const result = await docket(...args)
      expect(result.code, `${args.join(' ')}: ${result.stderr}`).toBe(0)
    }
    expect(await dockerCalls()).toEqual([])
  })

  it('never touches containers from open, browsing or asking', async () => {
    expect((await docket('sync')).code).toBe(0)
    const started = spawn(process.execPath, [CLI, 'open', '--no-open', '--port', '0'], { cwd: root, env: fakeDockerEnv() })
    try {
      let stdout = ''
      started.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      const url = await until(() => /http:\/\/127\.0\.0\.1:\d+\//.exec(stdout)?.[0], 'docket open to print its address')
      expect((await fetch(new URL('api/graph', url))).status).toBe(200)
      expect((await fetch(new URL('api/ask?q=orders', url))).status).toBe(200)
    } finally {
      const exited = new Promise((done) => started.once('exit', done))
      started.kill('SIGTERM')
      await exited
    }
    expect(await dockerCalls()).toEqual([])
  })

  it('plans with the configured image as given and every environment value redacted', async () => {
    const result = await docket('runtime', 'plan', 'graph-dev')
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('image        registry.internal.example/neo4j:5.26')
    expect(result.stdout).toContain('environment  NEO4J_AUTH=<redacted>')
    expect(result.stdout).toContain('adapters      jsonl')
    expect(result.stdout).not.toContain('never-print-me')

    const compose = `compose --file ${join(root!, 'infra/docket-memory.compose.yaml')} --project-name docket-payments`
    expect(await dockerCalls()).toEqual([`${compose} config --format json graph`])
  })

  it('runs up, status and down as explicit commands only', async () => {
    expect((await docket('runtime', 'up', 'graph-dev')).stdout).toContain('runtime graph-dev is up')
    expect((await docket('runtime', 'status', 'graph-dev')).stdout).toMatch(/graph\s+running \(healthy\)/)
    expect((await docket('runtime', 'down', 'graph-dev')).stdout).toContain('its volumes are kept')
    expect((await docket('runtime', 'down', 'graph-dev', '--destroy-volumes')).stdout).toContain('its volumes are deleted')

    const compose = `compose --file ${join(root!, 'infra/docket-memory.compose.yaml')} --project-name docket-payments`
    expect(await dockerCalls()).toEqual([
      `${compose} up --detach --pull never --no-build graph`,
      `ps --all --filter label=com.docker.compose.project=docket-payments --format {{.Label "com.docker.compose.service"}}\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}`,
      `${compose} down graph`,
      `${compose} down --volumes graph`
    ])
  })

  it('fails the plan when the Compose file is missing, without running anything', async () => {
    await writeFile(join(root!, '.docket.yaml'), CONFIG.replace('docket-memory.compose.yaml', 'absent.yaml'))
    const result = await docket('runtime', 'plan', 'graph-dev')
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/absent\.yaml does not exist/)
    expect(await dockerCalls()).toEqual([])
  })
})
