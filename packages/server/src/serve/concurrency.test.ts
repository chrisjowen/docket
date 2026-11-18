import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { STORES, makeDatabase, startTestServe, type TestServe } from '../../test/serve.js'

/**
 * Several people and agents writing to one docket at once lose nothing: every
 * write lands, whoever sends it and whichever process takes it. Over files,
 * writes take turns on the project's lock file, so another process writing to
 * the same project - `docket open`'s MCP server, a second `docket serve` -
 * waits its turn too; over Postgres, the store's row locks serialise them.
 */

const WRITER = fileURLToPath(new URL('../../test/fixtures/serve/writer.mjs', import.meta.url))
const run = promisify(execFile)

const note = (who: string, index: number) => ({ id: 'service.orders', evidence: [{ source: 'human', note: `${who} note ${index}` }] })

describe.each(STORES)('concurrent writers over $kind', ({ kind, skip }) => {
  let serve: TestServe
  let database: Awaited<ReturnType<typeof makeDatabase>> | null = null

  beforeAll(async () => {
    if (skip) return
    database = kind === 'postgres' ? await makeDatabase() : null
    serve = await startTestServe(kind, database ? { database: database.url } : {})
    for (const [id, type, title] of [
      ['team.payments', 'team', 'Payments'],
      ['service.orders', 'service', 'Orders API']
    ] as const) {
      const written = await serve.call(serve.tokens.owner, 'docket_remember', { id, type, title, evidence: [{ source: 'human' }] })
      expect(written.result?.isError, written.text).toBeUndefined()
    }
  })
  afterAll(async () => {
    await serve?.close()
    await database?.drop()
  })

  it.skipIf(skip)('keeps every write two tokens send at once', async () => {
    const calls = Array.from({ length: 12 }, (_, index) =>
      serve.call(index % 2 ? serve.tokens.owner : serve.tokens.editor, 'docket_add_evidence', note(index % 2 ? 'owner' : 'editor', index))
    )
    const answers = await Promise.all(calls)
    expect(answers.filter((answer) => answer.result?.isError || answer.error).map((answer) => answer.text)).toEqual([])
    const resource = await serve.call(serve.tokens.owner, 'docket_get', { id: 'service.orders' })
    const notes = JSON.stringify(resource.result?.structuredContent)
    for (let index = 0; index < 12; index += 1) expect(notes).toContain(`${index % 2 ? 'owner' : 'editor'} note ${index}`)
  })

  it.skipIf(skip || kind !== 'files')('takes turns with another process writing to the same project', async () => {
    const [other, ...answers] = await Promise.all([
      run(process.execPath, [WRITER, serve.project, '10'], { cwd: fileURLToPath(new URL('../..', import.meta.url)) }),
      ...Array.from({ length: 10 }, (_, index) => serve.call(serve.tokens.editor, 'docket_add_evidence', note('server', index)))
    ])
    expect(JSON.parse(other.stdout)).toEqual({ written: 10, failed: [] })
    expect(answers.filter((answer) => answer.result?.isError || answer.error).map((answer) => answer.text)).toEqual([])
    const raw = await readFile(join(serve.project, '.docket/resources/services/orders.md'), 'utf8')
    for (let index = 0; index < 10; index += 1) {
      expect(raw).toContain(`process note ${index}`)
      expect(raw).toContain(`server note ${index}`)
    }
  })

  it.skipIf(skip)('refuses the second of two publishes made against the same head', async () => {
    const head = (await serve.call(serve.tokens.owner, 'docket_ontology', {})).result?.structuredContent as { version: number }
    const [first, second] = await Promise.all(
      ['queue', 'topic'].map((type) =>
        serve.call(serve.tokens.owner, 'docket_publish_ontology_change', { patch: `resourceTypes:\n  ${type}:\n    description: A ${type}.\n`, expectedHead: head.version })
      )
    )
    const outcomes = [first, second].map((answer) => (answer?.result?.isError ? 'refused' : 'published')).sort()
    expect(outcomes).toEqual(['published', 'refused'])
    expect([first, second].find((answer) => answer?.result?.isError)?.text).toMatch(/Nothing was published: the draft was made against v1/)
  })
})
