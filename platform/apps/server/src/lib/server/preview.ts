// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

/**
 * Settings for running the app as a local preview inside a tool (the
 * Wheelhouse Preview tab), never for a deployment: each one is refused unless
 * the app serves plain HTTP on a loopback address, and in production.
 */

/** Is the app's public origin a plain-HTTP loopback address, as only a local preview is? */
export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

const FRAME_SOURCE = /^('self'|http:\/\/(\*\.)?localhost(:(\d+|\*))?|http:\/\/127\.0\.0\.1(:(\d+|\*))?)$/

/**
 * The CSP's `frame-ancestors`: `'none'` unless `DOCKET_FRAME_ANCESTORS` lists
 * loopback origins (a local preview shown inside a tool's frame). Only
 * `'self'` and http origins on localhost, `*.localhost` or 127.0.0.1 are
 * accepted, so the setting can neither let a real site frame the app nor
 * rewrite the rest of the policy.
 */
export function frameAncestors(raw: string | undefined, env: { origin: string; production: boolean }): string {
  const list = (raw ?? '').trim().split(/\s+/).filter(Boolean)
  if (list.length === 0) return "'none'"
  if (env.production || !isLocalOrigin(env.origin)) {
    throw new Error('DOCKET_FRAME_ANCESTORS is for a local preview only: refused for a non-loopback origin or in production')
  }
  for (const source of list) {
    if (!FRAME_SOURCE.test(source)) {
      throw new Error(`DOCKET_FRAME_ANCESTORS lists loopback origins like http://localhost:4310, not ${source}`)
    }
  }
  return list.join(' ')
}

/** Puts the configured `frame-ancestors` into a CSP header SvelteKit built with `'none'`. */
export function withFrameAncestors(policy: string, ancestors: string): string {
  if (ancestors === "'none'") return policy
  return policy.replace(/frame-ancestors 'none'/, `frame-ancestors ${ancestors}`)
}

export interface DemoLogin {
  login: string
  /** The GitHub id the fake GitHub gives this login, so the demo user and a fake-GitHub sign-in are one user. */
  githubId: number
}

const digest = (text: string) => createHash('sha256').update(text).digest()

/** The fake GitHub's stable numeric id per login (tests/fake-github/server.mjs). */
export function fakeGitHubId(login: string): number {
  return digest(login.toLowerCase()).readUInt32BE(0)
}

/**
 * A one-click demo sign-in for a local preview, as the login `DOCKET_DEMO_LOGIN`
 * names: off when unset, and refused for a non-loopback origin or in production, so a
 * deployment can never offer it.
 */
export function demoLogin(raw: string | undefined, env: { origin: string; production: boolean }): DemoLogin | null {
  if (!raw) return null
  if (env.production || !isLocalOrigin(env.origin)) {
    throw new Error('DOCKET_DEMO_LOGIN is for a local preview only: refused for a non-loopback origin or in production')
  }
  const login = raw.trim().toLowerCase()
  if (!/^[a-z0-9-]{1,39}$/.test(login)) {
    throw new Error('DOCKET_DEMO_LOGIN is a GitHub login, like alice')
  }
  return { login, githubId: fakeGitHubId(login) }
}
