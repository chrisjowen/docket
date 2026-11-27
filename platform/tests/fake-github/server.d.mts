// SPDX-License-Identifier: AGPL-3.0-only
// Types for the fake GitHub, so TypeScript tests can drive it.
import type { Server } from 'node:http'

export interface FakePull {
  number: number
  title: string
  body: string
  head: string
  base: string
  state: 'open' | 'merged'
}

export interface FakeRepo {
  id: number
  fullName: string
  defaultBranch: string
  private: boolean
  refs: Map<string, string>
  pulls: FakePull[]
}

export interface FakeDelivery {
  event: string
  delivery: string
  status: number
  body: string
}

export interface FakeGit {
  createRepo(input: { fullName: string; defaultBranch?: string; files?: Record<string, string>; private?: boolean }): { id: number; sha: string }
  createInstallation(input: { account: string; repos?: string[]; users?: string[] }): { id: number }
  /** Commits file changes (null deletes a file or a whole directory) and sends the push webhook. */
  push(
    fullName: string,
    input: { branch?: string; files?: Record<string, string | null>; message?: string; webhook?: boolean },
  ): Promise<{ sha: string; delivery: FakeDelivery | null }>
  mergePull(fullName: string, number: number): Promise<{ sha: string; delivery: FakeDelivery | null }>
  repos: Map<string, FakeRepo>
  deliveries: FakeDelivery[]
  /** Every file on a branch (default: the default branch), path -> blob SHA. */
  filesAt(fullName: string, branch?: string): Map<string, string>
}

export function startFakeGitHub(options?: {
  port?: number
  clientId?: string
  clientSecret?: string
  demoLogin?: string
  app?: { id: string | number; publicKey: string; setupUrl: string } | null
  webhook?: { url: string; secret: string } | null
}): Promise<{ server: Server; url: string; git: FakeGit }>
