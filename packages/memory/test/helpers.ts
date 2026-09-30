import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The real binary `pnpm build` produces. These tests deliberately exercise the
 * shipped artefact rather than the sources, so they catch anything that only
 * breaks once compiled and packaged.
 */
export const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

/** Run `memory <args>` in `root` through the built CLI. Never throws on a non-zero exit. */
export const memory = async (
  root: string,
  ...args: string[]
): Promise<CliResult> => {
  if (!existsSync(CLI)) {
    throw new Error(
      `${CLI} does not exist - run \`pnpm -C packages/memory build\` before the end-to-end tests.`
    )
  }
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      cwd: root
    })
    return { code: 0, stdout, stderr }
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string }
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? ''
    }
  }
}

/**
 * A fresh temp repository with `memory init` already run through the CLI.
 * Real-pathed because macOS's `/tmp` is a symlink and chokidar reports the
 * resolved path.
 */
export const makeRepo = async (prefix: string): Promise<string> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), `${prefix}-`)))
  const result = await memory(root, 'init')
  if (result.code !== 0) {
    throw new Error(`memory init failed in ${root}: ${result.stderr}`)
  }
  return root
}

export const removeRepo = (root: string | undefined): Promise<void> =>
  root ? rm(root, { recursive: true, force: true }) : Promise.resolve()

/** Write a canonical file at a repo-relative path, creating parent directories. */
export const write = async (
  root: string,
  relativePath: string,
  contents: string
): Promise<void> => {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

export const INDEX = '.memory/.index'

/** Every file in the index directory, keyed by name, as raw text. */
export const indexFiles = async (
  root: string
): Promise<Record<string, string>> => {
  const dir = join(root, INDEX)
  const contents: Record<string, string> = {}
  for (const entry of (await readdir(dir)).sort()) {
    contents[entry] = await readFile(join(dir, entry), 'utf8')
  }
  return contents
}

/** SHA-256 of every index file, so two runs can be compared byte for byte (spec §72). */
export const indexDigests = async (
  root: string
): Promise<Record<string, string>> => {
  const dir = join(root, INDEX)
  const digests: Record<string, string> = {}
  for (const entry of (await readdir(dir)).sort()) {
    const bytes = await readFile(join(dir, entry))
    digests[entry] = createHash('sha256').update(bytes).digest('hex')
  }
  return digests
}

/** Parse one JSONL index file. */
export const readJsonl = async <T>(
  root: string,
  name: string
): Promise<T[]> => {
  const raw = await readFile(join(root, INDEX, name), 'utf8').catch(() => '')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T)
}

/**
 * Poll until `check` returns something, rather than sleeping a guessed
 * interval - watcher timing depends on the filesystem, not on us.
 */
export const until = async <T>(
  check: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 15_000
): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 25))
  }
}

/**
 * Chokidar's `ready` event only means its own initial walk finished; on macOS
 * the OS-level watch can take longer to start delivering, and a change made in
 * that window produces no event at all (issue #10).
 *
 * Rewriting the ontology with its own contents is a side-effect-free probe -
 * the resync it triggers is hash gated - so waiting for the watcher to report
 * the reload proves events are really flowing before a test asserts anything.
 * The rewrite repeats, because a child process cannot tell us when it started
 * listening and an early rewrite is simply never heard.
 *
 * In-process callers do not need this: `watch()` returns only once events are
 * flowing. Callers reset their own event log afterwards.
 */
export const probeWatcherReady = async (
  root: string,
  reloaded: () => boolean
): Promise<void> => {
  const ontology = join(root, '.memory/entities.yaml')
  const contents = await readFile(ontology, 'utf8')
  let lastTouch = 0
  await until(async () => {
    if (reloaded()) return true
    if (Date.now() - lastTouch > 500) {
      lastTouch = Date.now()
      await writeFile(ontology, contents, 'utf8')
    }
    return undefined
  }, 'the watcher to start delivering events')
}
