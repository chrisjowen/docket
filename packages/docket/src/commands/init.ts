import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { CONFIG_FILENAME } from '../config/config.js'
import {
  DEFAULT_CONFIG_YAML,
  DEFAULT_DIRECTORIES,
  DEFAULT_ONTOLOGY_PATH,
  GITIGNORE_ENTRY
} from '../config/defaults.js'
import { defaultConfig } from '../config/loader.js'

export interface InitOptions {
  /** Project root to initialize. Defaults to the process working directory. */
  cwd?: string | undefined
  /** Overwrite `.docket.yaml` and the ontology if they already exist. */
  force?: boolean | undefined
}

/** What `init` did, as project-relative paths, for the CLI to print. */
export interface InitResult {
  projectRoot: string
  created: string[]
  skipped: string[]
  updated: string[]
}

/**
 * Create `.docket.yaml`, the `.docket/` layout and the starting ontology
 * (spec sections 4, 5 and 33). Idempotent: an existing file is left alone and
 * reported as skipped unless `force` is set.
 */
export const init = async (options: InitOptions = {}): Promise<InitResult> => {
  const { memoryRoot, ontologyPath, projectRoot } = defaultConfig(
    options.cwd ?? process.cwd()
  )
  const force = options.force ?? false
  const result: InitResult = {
    projectRoot,
    created: [],
    skipped: [],
    updated: []
  }
  const rel = (path: string): string => relative(projectRoot, path)

  for (const dir of ['', ...DEFAULT_DIRECTORIES]) {
    const path = join(memoryRoot, dir)
    if (existsSync(path)) continue
    await mkdir(path, { recursive: true })
    result.created.push(`${rel(path)}/`)
  }

  const write = async (path: string, contents: string): Promise<void> => {
    if (!force && existsSync(path)) {
      result.skipped.push(rel(path))
      return
    }
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, contents, 'utf8')
    result.created.push(rel(path))
  }

  await write(join(projectRoot, CONFIG_FILENAME), DEFAULT_CONFIG_YAML)
  await write(ontologyPath, await readFile(DEFAULT_ONTOLOGY_PATH, 'utf8'))

  // Projections are disposable, so keep them out of version control. Only
  // amend a `.gitignore` that already exists - never create one.
  const gitignore = join(projectRoot, '.gitignore')
  if (existsSync(gitignore)) {
    const contents = await readFile(gitignore, 'utf8')
    if (contents.split('\n').some((line) => line.trim() === GITIGNORE_ENTRY)) {
      result.skipped.push('.gitignore')
    } else {
      const prefix = contents.length === 0 || contents.endsWith('\n') ? '' : '\n'
      await appendFile(gitignore, `${prefix}${GITIGNORE_ENTRY}\n`, 'utf8')
      result.updated.push('.gitignore')
    }
  }

  return result
}
