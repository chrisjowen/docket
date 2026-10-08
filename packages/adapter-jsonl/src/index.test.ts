import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertAdapterContract, fakeServices } from '@docket/contracts/testing'
import { describe, expect, it } from 'vitest'

import jsonl from './index.js'

describe('jsonl adapter', () => {
  it('holds the adapter contract', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'docket-jsonl-adapter-')))
    const report = await assertAdapterContract(jsonl, {
      config: { type: 'jsonl', output: '.docket/.index' },
      invalidConfig: { type: 'neo4j' },
      services: fakeServices({ projectRoot: root })
    })
    expect(report.checks.every((check) => check.ok)).toBe(true)
    expect(report.checks.map((check) => check.name)).toContain('query.ask returns a valid answer')
  })

  it('reads a v1 projection entry, with or without its type', () => {
    expect(jsonl.validateConfig({ type: 'jsonl' })).toEqual({ type: 'jsonl', output: '.docket/.index' })
    expect(jsonl.validateConfig({ output: '.docket/.out' })).toEqual({ type: 'jsonl', output: '.docket/.out' })
    expect(() => jsonl.validateConfig({ type: 'neo4j' })).toThrow()
    expect(() => jsonl.validateConfig({ ouput: '.docket/.out' })).toThrow(/Unrecognized key: "ouput"/)
  })
})
