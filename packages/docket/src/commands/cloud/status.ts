import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { checkoutScope, type CredentialStore } from '@docket/adapter-kit'

import { cloudOntology, listDocuments } from '../../cloud/client.js'
import { linkedWorkspace } from '../../cloud/credentials.js'
import { cloudLinkOf } from '../../cloud/project.js'
import { loadConfig } from '../../config/loader.js'
import { hashContent } from '../../source/hashing.js'
import { sourceFiles } from '../../source/scanner.js'

export interface CloudStatusOptions {
  cwd?: string | undefined
  store?: CredentialStore | undefined
  env?: NodeJS.ProcessEnv | undefined
}

/** One part of the status, or why it could not be found out. */
export type Part<T> = ({ ok: true } & T) | { ok: false; error: string }

export interface CloudStatusResult {
  projectRoot: string
  link?: { adapter: string; workspace: string; url: string }
  session?: { kind: 'session'; expiresAt?: string; scope?: string } | { kind: 'token-env'; variable: string } | { kind: 'none' }
  ontology?: Part<{ local?: string; version: number; same: boolean }>
  pending?: Part<{ upload: number; remove: number }>
}

const settle = async <T>(work: () => Promise<T>): Promise<Part<T>> => {
  try {
    return { ok: true, ...(await work()) }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Where the project stands with the cloud: its link, its sign-in, its
 * ontology against the published one, and the files a push would send.
 * Each part the cloud has to answer reports its own failure, so status still
 * shows what it knows offline.
 */
export const cloudStatus = async (options: CloudStatusOptions = {}): Promise<CloudStatusResult> => {
  const resolved = await loadConfig(options.cwd ?? process.cwd())
  const result: CloudStatusResult = { projectRoot: resolved.projectRoot }
  const link = cloudLinkOf(resolved)
  if (link === undefined) return result
  const env = options.env ?? process.env
  const workspace = linkedWorkspace(link, { store: options.store, env })
  result.link = { adapter: link.id, workspace: `${link.org}/${link.workspace}`, url: link.url }

  if (link.tokenEnv !== undefined && env[link.tokenEnv]) {
    result.session = { kind: 'token-env', variable: link.tokenEnv }
  } else {
    const credential = await workspace.store.read(workspace.resource)
    result.session =
      credential === undefined
        ? { kind: 'none' }
        : { kind: 'session', ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}), ...(credential.scope ? { scope: credential.scope } : {}) }
  }

  result.ontology = await settle(async () => {
    const cloud = await cloudOntology(workspace)
    const local = existsSync(resolved.ontologyPath) ? hashContent(await readFile(resolved.ontologyPath, 'utf8')) : undefined
    return { ...(local ? { local } : {}), version: cloud.version, same: local === hashContent(cloud.yaml) }
  })

  result.pending = await settle(async () => {
    const remote = new Map(
      (await listDocuments(workspace, { origin: 'cli', originRef: checkoutScope(resolved.projectRoot) })).map((document) => [document.path, document.hash])
    )
    let upload = 0
    const kept = new Set<string>()
    for (const file of await sourceFiles(resolved)) {
      kept.add(file.path)
      if (remote.get(file.path) !== hashContent(await readFile(file.absolute, 'utf8'))) upload += 1
    }
    return { upload, remove: [...remote.keys()].filter((path) => !kept.has(path)).length }
  })
  return result
}
