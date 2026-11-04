import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { v2ConfigSchema } from '../../config/config.js'
import { init } from '../init.js'
import { cloudLink } from './link.js'

let root: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'docket-cloud-link-')))
  await init({ cwd: root })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const configText = (): Promise<string> => readFile(join(root, '.docket.yaml'), 'utf8')

describe('docket cloud link', () => {
  it('adds a query-only cloud adapter entry, and the file still parses under v2ConfigSchema', async () => {
    await cloudLink('acme/platform', { cwd: root, url: 'https://docket.example.test/' })

    const config = v2ConfigSchema.parse(parse(await configText()))
    expect(config.adapters.find((adapter) => adapter.id === 'cloud')).toEqual({
      id: 'cloud',
      module: '@docket/adapter-cloud',
      roles: ['query'],
      config: { url: 'https://docket.example.test', workspace: 'acme/platform' }
    })
  })

  it('keeps the adapters and comments the file already had', async () => {
    const before = await configText()
    await writeFile(join(root, '.docket.yaml'), `# kept\n${before}`)

    await cloudLink('acme/platform', { cwd: root })

    const text = await configText()
    expect(text.startsWith('# kept\n')).toBe(true)
    const config = v2ConfigSchema.parse(parse(text))
    expect(config.adapters.map((adapter) => adapter.id)).toEqual(['local', 'cloud'])
    expect(config.adapters[1]?.config).toEqual({ url: 'https://docket.chrisjowen.net', workspace: 'acme/platform' })
  })

  it('names the token variable for CI, never a token', async () => {
    await cloudLink('acme/platform', { cwd: root, tokenEnv: 'DOCKET_CLOUD_TOKEN' })

    const config = v2ConfigSchema.parse(parse(await configText()))
    expect(config.adapters[1]?.config).toMatchObject({ tokenEnv: 'DOCKET_CLOUD_TOKEN' })
    await expect(cloudLink('acme/other', { cwd: root, tokenEnv: 'dkt_live_abc def' })).rejects.toThrow(/environment variable name/)
  })

  it('refuses a second link, leaving the file as it was', async () => {
    await cloudLink('acme/platform', { cwd: root })
    const linked = await configText()

    await expect(cloudLink('acme/other', { cwd: root })).rejects.toThrow(/already linked to acme\/platform/)
    expect(await configText()).toBe(linked)
  })

  it('refuses a target that is not <org>/<workspace>', async () => {
    await expect(cloudLink('acme', { cwd: root })).rejects.toThrow(/is not <org>\/<workspace>/)
    await expect(cloudLink('acme/platform/extra', { cwd: root })).rejects.toThrow(/is not <org>\/<workspace>/)
  })

  it('asks for a version 1 file to be migrated first', async () => {
    await writeFile(join(root, '.docket.yaml'), 'version: 1\nprojections:\n  - type: jsonl\n')

    await expect(cloudLink('acme/platform', { cwd: root })).rejects.toThrow(/docket config migrate/)
  })
})
