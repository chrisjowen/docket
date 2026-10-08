import { mkdir, open, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Temp file + rename, because rename is atomic on the same filesystem: a crash
 * mid-write leaves the previous index intact rather than a half-written one
 * (spec §68).
 */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filePath)
}
