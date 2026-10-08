import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { writeFileAtomic } from '@docket/adapter-kit'

import { CONFIG_FILENAME } from '../config/config.js'
import { findConfigFile } from '../config/loader.js'
import { migrateConfigText } from '../config/migrate.js'

export interface ConfigMigrateOptions {
  /** Where to look for `.docket.yaml`, walking up. Defaults to the working directory. */
  cwd?: string | undefined
  /** Only show the version 2 file; write nothing. */
  dryRun?: boolean | undefined
  /** Write without asking - the explicit go-ahead `--write` gives. */
  write?: boolean | undefined
  /** Shown the version 2 file, asks whether to write it. Without it, and without `write`, nothing is written. */
  confirm?: ((question: string, text: string) => Promise<boolean>) | undefined
}

export type ConfigMigrateResult =
  /** Already version 2: nothing to do. */
  | { status: 'current'; file: string }
  /** `dryRun`: the version 2 file, not written. */
  | { status: 'preview'; file: string; text: string }
  /** Asked, and told not to write. */
  | { status: 'declined'; file: string; text: string }
  /** Written, the original kept at `backup`. */
  | { status: 'written'; file: string; backup: string; text: string }

/** Copies `contents` to the first of `<file>.v1.bak`, `<file>.v1.bak.2`, ... that does not exist - never over one that does. */
const backUp = async (file: string, contents: string): Promise<string> => {
  for (let attempt = 1; ; attempt++) {
    const backup = attempt === 1 ? `${file}.v1.bak` : `${file}.v1.bak.${attempt}`
    try {
      await writeFile(backup, contents, { encoding: 'utf8', flag: 'wx' })
      return backup
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    }
  }
}

/**
 * `docket config migrate`: rewrites a version 1 `.docket.yaml` as version 2
 * (docs/adapter-spec.md §15 step 3). A v1 file keeps working as it is - it is
 * converted as it loads - so this is never required. It writes only when
 * told to with `write`, or when `confirm` agrees, and keeps the original as a
 * backup first; `dryRun` only shows the result.
 */
export const configMigrate = async (options: ConfigMigrateOptions = {}): Promise<ConfigMigrateResult> => {
  if (options.dryRun && options.write) throw new Error('--dry-run and --write contradict each other; pass one.')

  const start = resolve(options.cwd ?? process.cwd())
  const file = findConfigFile(start)
  if (file === undefined) {
    throw new Error(`No ${CONFIG_FILENAME} found in ${start} or any parent directory.`)
  }

  const original = await readFile(file, 'utf8')
  const migration = migrateConfigText(original, file)
  if (migration.version === 2) return { status: 'current', file }

  const { text } = migration
  if (options.dryRun) return { status: 'preview', file, text }
  if (!options.write) {
    if (options.confirm === undefined) {
      throw new Error(
        `Not rewriting ${file} without confirmation. Pass --write to rewrite it (the original is kept as a backup), ` +
          'or --dry-run to see the version 2 file.'
      )
    }
    if (!(await options.confirm(`Rewrite ${file} as version 2, keeping the original as a backup?`, text))) {
      return { status: 'declined', file, text }
    }
  }

  const backup = await backUp(file, original)
  // Never overwrite an edit made since the file was read.
  if ((await readFile(file, 'utf8')) !== original) {
    await rm(backup, { force: true })
    throw new Error(`${file} changed while it was being migrated; it is left as it is. Run the migration again.`)
  }
  await writeFileAtomic(file, text)
  return { status: 'written', file, backup, text }
}
