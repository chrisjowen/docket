import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { emptyManifest, manifestPath, readManifest, writeManifest } from './manifest.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memory-manifest-'))
}

describe('manifest', () => {
  it('round-trips documents', async () => {
    const dir = await tempDir()
    const manifest = {
      version: 1,
      documents: {
        'agent.research-assistant': {
          path: '.docket/resources/agents/research-assistant.md',
          hash: 'sha256:abc123'
        }
      }
    }

    await writeManifest(dir, manifest)

    expect(await readManifest(dir)).toEqual(manifest)
  })

  it('returns an empty manifest when absent or unreadable', async () => {
    const dir = await tempDir()
    expect(await readManifest(dir)).toEqual(emptyManifest())

    await mkdir(dir, { recursive: true })
    await writeFile(manifestPath(dir), 'not json', 'utf8')
    expect(await readManifest(dir)).toEqual(emptyManifest())
  })

  it('writes ids in sorted order', async () => {
    const dir = await tempDir()
    await writeManifest(dir, {
      version: 1,
      documents: {
        'b.two': { path: 'b.md', hash: 'sha256:b' },
        'a.one': { path: 'a.md', hash: 'sha256:a' }
      }
    })

    const raw = await readFile(manifestPath(dir), 'utf8')
    expect(raw.indexOf('a.one')).toBeLessThan(raw.indexOf('b.two'))
    expect(raw.endsWith('\n')).toBe(true)
  })
})
