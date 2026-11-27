// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'

import { demoLogin, fakeGitHubId, frameAncestors, withFrameAncestors } from './preview'

const local = { origin: 'http://localhost:4480', production: false }

describe('frame ancestors', () => {
  it("is 'none' unless set", () => {
    expect(frameAncestors(undefined, local)).toBe("'none'")
    expect(frameAncestors('  ', { origin: 'https://docket.example.com', production: true })).toBe("'none'")
  })

  it('lists loopback origins for a local preview inside a tool', () => {
    const list = 'http://localhost:4310 http://127.0.0.1:4310 http://*.localhost:4310'
    expect(frameAncestors(` ${list} `, local)).toBe(list)
    const policy = "default-src 'self'; frame-ancestors 'none'; form-action 'self'"
    expect(withFrameAncestors(policy, list)).toBe(`default-src 'self'; frame-ancestors ${list}; form-action 'self'`)
    expect(withFrameAncestors(policy, "'none'")).toBe(policy)
  })

  it('refuses anything but a loopback origin, so the policy cannot be rewritten', () => {
    for (const bad of ['*', 'https://evil.example', "http://localhost; script-src 'unsafe-inline'", 'http://localhost.evil.example']) {
      expect(() => frameAncestors(bad, local), bad).toThrow(/DOCKET_FRAME_ANCESTORS/)
    }
  })

  it('cannot be turned on for a deployment', () => {
    expect(() => frameAncestors('http://localhost:4310', { origin: 'https://docket.example.com', production: false })).toThrow(/local preview only/)
    expect(() => frameAncestors('http://localhost:4310', { origin: 'http://localhost:4480', production: true })).toThrow(/local preview only/)
  })
})

describe('demo login', () => {
  it('is off unless set, and names one login, the fake GitHub user it signs in as', () => {
    expect(demoLogin(undefined, local)).toBeNull()
    expect(demoLogin('', local)).toBeNull()
    expect(demoLogin(' Alice ', local)).toEqual({ login: 'alice', githubId: fakeGitHubId('alice') })
  })

  it('cannot be turned on for a deployment, nor for a login GitHub could not have', () => {
    for (const origin of ['https://docket.example.com', 'http://docket.example.com', 'https://localhost:4480', 'http://localhost.evil.example']) {
      expect(() => demoLogin('alice', { origin, production: false }), origin).toThrow(/local preview only/)
    }
    expect(() => demoLogin('alice', { origin: 'http://127.0.0.1:4480', production: true })).toThrow(/local preview only/)
    expect(() => demoLogin('alice', { origin: 'http://[::1]:4480', production: true })).toThrow(/local preview only/)
    for (const bad of ['alice:docket-demo', ':docket-demo', 'alice bob', 'al/ice', 'a'.repeat(40)]) {
      expect(() => demoLogin(bad, local), bad).toThrow(/GitHub login/)
    }
  })
})
