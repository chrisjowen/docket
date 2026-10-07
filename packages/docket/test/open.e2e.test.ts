import { spawn, type ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { CLI, makeRepo, memory, removeRepo, until, write } from './helpers.js'

/**
 * Smoke test of the shipped `docket open`: the built CLI serves the built web
 * UI - the copy the npm package carries in dist/ui - and the API beside it.
 */

let root: string | undefined
let child: ChildProcess | undefined

afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((done) => child?.once('exit', done))
    child.kill('SIGTERM')
    await exited
  }
  child = undefined
  await removeRepo(root)
  root = undefined
})

describe('docket open', () => {
  it('serves the built UI and the graph API until stopped', async () => {
    root = await makeRepo('docket-open-e2e')
    await write(
      root,
      '.docket/resources/teams/payments.md',
      '---\nid: team.payments\ntype: team\ntitle: Payments\n---\n\nThe payments team.\n'
    )
    expect((await memory(root, 'sync')).code).toBe(0)

    const started = spawn(process.execPath, [CLI, 'open', '--no-open', '--port', '0'], { cwd: root })
    child = started
    let stdout = ''
    started.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    const url = await until(() => /http:\/\/127\.0\.0\.1:\d+\//.exec(stdout)?.[0], 'docket open to print its address')

    const page = await fetch(url)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('<title>docket</title>')
    // The page's own scripts are served too, not just the shell.
    const script = /(?:src|href)="\.?\/?(_app\/immutable\/[^"]+\.js)"/.exec(html)?.[1]
    expect(script).toBeDefined()
    expect((await fetch(new URL(script as string, url))).status).toBe(200)

    const graph = (await (await fetch(new URL('api/graph', url))).json()) as { entities: { id: string }[] }
    expect(graph.entities.map((entity) => entity.id)).toEqual(['team.payments'])

    const answer = (await (await fetch(new URL('api/ask?q=payments', url))).json()) as { documents: { id: string }[] }
    expect(answer.documents.map((document) => document.id)).toEqual(['team.payments'])

    const exited = new Promise<number | null>((done) => started.once('exit', done))
    started.kill('SIGTERM')
    expect(await exited).toBe(0)
  })

  it('refuses to start outside a repository', async () => {
    root = await makeRepo('docket-open-e2e')
    await rm(join(root, '.docket.yaml'))

    const result = await memory(root, 'open', '--no-open', '--port', '0')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('docket init')
  })
})
