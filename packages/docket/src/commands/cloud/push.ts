import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { checkoutScope, type CredentialStore } from '@docket/adapter-kit'

import {
  cloudOntology,
  listDocuments,
  proposeOntology,
  pushDocuments,
  type OntologyProposal,
  type PushDiagnostic,
  type PushResponse
} from '../../cloud/client.js'
import { linkedWorkspace } from '../../cloud/credentials.js'
import { requireCloudLink } from '../../cloud/project.js'
import { hashContent } from '../../source/hashing.js'
import { sourceFiles } from '../../source/scanner.js'

/** A push request stays under this, well inside the cloud's 1 MB request cap. */
export const PUSH_BATCH_BYTES = 768 * 1024

export interface CloudPushOptions {
  cwd?: string | undefined
  /** Ask the cloud to validate and report, writing nothing. */
  dryRun?: boolean | undefined
  store?: CredentialStore | undefined
  env?: NodeJS.ProcessEnv | undefined
}

export interface CloudPushResult {
  workspace: string
  /** The id the cloud keys this checkout's documents by. */
  checkout: string
  dryRun: boolean
  /** Paths the cloud accepted because its copy was missing or differed. */
  uploaded: string[]
  /** Paths the cloud held for this checkout that it no longer has, retired. */
  removed: string[]
  /** Changed paths, or ones to retire, the cloud did not store: its batch was refused, or came after one that was. */
  notStored: string[]
  /** Files whose hash matched the cloud's, so were not sent. */
  unchanged: number
  /** Whether the cloud accepted every batch; false when its validator refused one. */
  ok: boolean
  diagnostics: PushDiagnostic[]
  ontology:
    | { state: 'same'; version: number }
    | { state: 'differs'; version: number }
    | { state: 'proposed'; version: number; proposal: OntologyProposal }
    | { state: 'absent' }
}

/** Upserts in batches under the request cap; removals ride with the first. */
const batches = (upserts: { path: string; raw: string }[]): { path: string; raw: string }[][] => {
  const out: { path: string; raw: string }[][] = [[]]
  let size = 0
  for (const upsert of upserts) {
    const bytes = Buffer.byteLength(JSON.stringify(upsert), 'utf8')
    if (size + bytes > PUSH_BATCH_BYTES && out.at(-1)!.length > 0) {
      out.push([])
      size = 0
    }
    out.at(-1)!.push(upsert)
    size += bytes
  }
  return out
}

/**
 * Uploads the checkout's canonical files to the linked workspace as `cli`
 * documents keyed by the checkout: only those whose hash differs from the
 * cloud's copy, and the retirement of any the checkout no longer has. Prints
 * nothing itself: the cloud's validator diagnostics come back in the result.
 * A local ontology that differs from the published one is proposed as a
 * draft - the cloud never publishes it from here - unless the cloud refused
 * the files.
 */
export const cloudPush = async (options: CloudPushOptions = {}): Promise<CloudPushResult> => {
  const { resolved, link } = await requireCloudLink(options.cwd ?? process.cwd())
  const workspace = linkedWorkspace(link, { store: options.store, env: options.env })
  const checkout = checkoutScope(resolved.projectRoot)
  const dryRun = options.dryRun === true

  const local = await Promise.all(
    (await sourceFiles(resolved)).map(async (file) => {
      const raw = await readFile(file.absolute, 'utf8')
      return { path: file.path, raw, hash: hashContent(raw) }
    })
  )
  const remote = new Map((await listDocuments(workspace, { origin: 'cli', originRef: checkout })).map((document) => [document.path, document.hash]))
  const changed = local.filter((file) => remote.get(file.path) !== file.hash)
  const kept = new Set(local.map((file) => file.path))
  const removed = [...remote.keys()].filter((path) => !kept.has(path)).sort()

  const responses: PushResponse[] = []
  const stored: string[] = []
  const retired: string[] = []
  if (changed.length > 0 || removed.length > 0) {
    for (const [index, batch] of batches(changed.map(({ path, raw }) => ({ path, raw }))).entries()) {
      const remove = index === 0 ? removed : []
      const response = await pushDocuments(workspace, { checkout, dryRun, upsert: batch, remove })
      responses.push(response)
      if (!response.ok) break
      stored.push(...batch.map((upsert) => upsert.path))
      retired.push(...remove)
    }
  }
  const ok = responses.every((response) => response.ok)
  const accepted = new Set([...stored, ...retired])

  const cloud = await cloudOntology(workspace)
  let ontology: CloudPushResult['ontology']
  if (!existsSync(resolved.ontologyPath)) {
    ontology = { state: 'absent' }
  } else {
    const yaml = await readFile(resolved.ontologyPath, 'utf8')
    if (hashContent(yaml) === hashContent(cloud.yaml)) ontology = { state: 'same', version: cloud.version }
    else if (dryRun || !ok) ontology = { state: 'differs', version: cloud.version }
    else {
      const proposal = await proposeOntology(workspace, yaml, `Proposed by docket cloud push from ${checkout}`)
      ontology = { state: 'proposed', version: cloud.version, proposal }
    }
  }

  return {
    workspace: workspace.label,
    checkout,
    dryRun,
    uploaded: stored,
    removed: retired,
    notStored: [...changed.map((file) => file.path), ...removed].filter((path) => !accepted.has(path)),
    unchanged: local.length - changed.length,
    ok,
    diagnostics: responses.flatMap((response) => response.diagnostics),
    ontology
  }
}
