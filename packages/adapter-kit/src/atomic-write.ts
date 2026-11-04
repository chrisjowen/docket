import { mkdir, open, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Temp file + rename, because rename is atomic on the same filesystem: a crash
 * mid-write leaves the previous index intact rather than a half-written one
 * (spec §68). `mode` is the new file's, set as it is created - so a file of
 * secrets is never readable by others, even for a moment.
 */
export async function writeFileAtomic(filePath: string, contents: string, options: { mode?: number } = {}): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  const handle = await open(temporary, 'w', options.mode)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filePath)
}
