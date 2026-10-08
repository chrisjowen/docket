import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findPackageDir } from '../adapters/resolve-module.js'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

const MANIFEST = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  peerDependencies?: Record<string, string>
}

/** The range docket supports for an optional driver, from its own peer dependencies: `neo4j-driver@^6.0.0`. */
export const driverSpec = (name: string): string => {
  const range = MANIFEST.peerDependencies?.[name]
  return range === undefined ? name : `${name}@${range}`
}

/** Lockfiles, in the order a project with several is most likely to mean. */
const LOCKFILES: readonly [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm']
]

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The package manager a project uses: its `packageManager` field, else its
 * lockfile, else npm. Undefined when the directory has no `package.json`,
 * since there is then no project to install into.
 */
export const detectPackageManager = (projectRoot: string): PackageManager | undefined => {
  const manifest = readJson(join(projectRoot, 'package.json'))
  if (manifest === undefined) return undefined
  const declared = (manifest as { packageManager?: unknown }).packageManager
  if (typeof declared === 'string') {
    const name = declared.split('@')[0]
    if (name === 'pnpm' || name === 'npm' || name === 'yarn' || name === 'bun') return name
  }
  for (const [lockfile, manager] of LOCKFILES) {
    if (existsSync(join(projectRoot, lockfile))) return manager
  }
  return 'npm'
}

/** The command adding `spec` as a dev dependency of the project at `projectRoot` with `manager`. */
export const installCommand = (manager: PackageManager, spec: string, projectRoot: string): string[] => {
  switch (manager) {
    case 'pnpm':
      // At a workspace root pnpm refuses to add a dependency without -w.
      return ['pnpm', 'add', '--save-dev', ...(existsSync(join(projectRoot, 'pnpm-workspace.yaml')) ? ['-w'] : []), spec]
    case 'yarn':
      return ['yarn', 'add', '--dev', spec]
    case 'bun':
      return ['bun', 'add', '--dev', spec]
    case 'npm':
      return ['npm', 'install', '--save-dev', spec]
  }
}

/** Whether the project can already import `name`. */
export const isInstalled = (name: string, projectRoot: string): boolean => findPackageDir(name, projectRoot) !== undefined
