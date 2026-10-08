import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import {
  CONFIG_FILENAME,
  memoryConfigSchema,
  type MemoryConfig,
  type ResolvedConfig
} from './config.js'

/**
 * Walk up from `startDir` to the filesystem root looking for `.docket.yaml`.
 * Returns the absolute path, or undefined when the repository has none.
 */
export const findConfigFile = (startDir: string): string | undefined => {
  let dir = resolve(startDir)
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

const absolutize = (root: string, path: string): string =>
  isAbsolute(path) ? path : resolve(root, path)

/** Attach the absolute paths every other module resolves against. */
export const resolveConfig = (
  config: MemoryConfig,
  projectRoot: string
): ResolvedConfig => ({
  config,
  projectRoot,
  memoryRoot: absolutize(projectRoot, config.source.root),
  ontologyPath: absolutize(projectRoot, config.ontology.file)
})

/**
 * The fully-defaulted config a fresh project gets, without touching disk.
 * `docket init` uses this to place the files it creates.
 */
export const defaultConfig = (projectRoot: string): ResolvedConfig =>
  resolveConfig(memoryConfigSchema.parse({ version: 2 }), resolve(projectRoot))

/** Find, parse and validate the nearest `.docket.yaml`. */
export const loadConfig = async (
  startDir: string = process.cwd()
): Promise<ResolvedConfig> => {
  const file = findConfigFile(startDir)
  if (file === undefined) {
    throw new Error(
      `No ${CONFIG_FILENAME} found in ${resolve(startDir)} or any parent ` +
        `directory. Run \`docket init\` to create one.`
    )
  }

  const parsed = memoryConfigSchema.safeParse(parse(await readFile(file, 'utf8')))
  if (!parsed.success) {
    throw new Error(`Invalid ${file}:\n${z.prettifyError(parsed.error)}`)
  }

  return resolveConfig(parsed.data, dirname(file))
}
