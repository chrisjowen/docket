import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { CLI } from './helpers.js'

const run = promisify(execFile)

/**
 * `npx @chrisjowen/docket setup` as CI or a script runs it: the shipped binary,
 * stdin a pipe rather than a terminal, and a fake `claude` that records its
 * argv. Nothing may be asked, so the run must finish on its own.
 */

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('docket setup without a terminal', () => {
  it('installs the plugin, asks nothing and says what it did', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'docket-setup-e2e-')))
    const repo = join(dir, 'repo')
    const bin = join(dir, 'bin')
    await mkdir(repo)
    await mkdir(bin)
    await symlink(process.execPath, join(bin, 'node'))
    const calls = join(dir, 'calls.txt')
    await writeFile(join(bin, 'claude'), `#!/bin/sh\necho "$*" >> "${calls}"\n`)
    await chmod(join(bin, 'claude'), 0o755)

    const { stdout } = await run(process.execPath, [CLI, 'setup', '--team'], {
      cwd: repo,
      env: { PATH: [bin, '/usr/bin', '/bin'].join(delimiter), HOME: dir },
      timeout: 15_000
    })

    expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual([
      'plugin marketplace list --json',
      'plugin marketplace add chrisjowen/docket --scope project',
      'plugin list --json',
      'plugin install docket@docket --scope project'
    ])
    expect(stdout).toMatch(/✓ plugin\s+installed docket@docket \(project scope\)/)
    expect(stdout).toMatch(/- repository\s+no \.docket\.yaml; not set up without --yes/)
    expect(stdout).toMatch(/- cli\s+not installed globally/)
    expect(stdout).toContain('Commit .claude/settings.json')
    expect(existsSync(join(repo, '.docket.yaml'))).toBe(false)
  })
})
