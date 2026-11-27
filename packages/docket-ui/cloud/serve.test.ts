// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { compatible, routePattern, webUi } from './serve.js'

describe('the web UI as a server serves it', () => {
  it('reads route ids as address patterns', () => {
    const access = routePattern('/o/[org]/w/[ws]/access')
    expect(access.test('/o/acme/w/platform/access')).toBe(true)
    expect(access.test('/o/acme/w/platform/access/')).toBe(true)
    expect(access.test('/o/acme/w/platform/overview')).toBe(false)
    expect(access.test('/o/acme/w/platform/access/more')).toBe(false)
    expect(routePattern('/o/[org]/w/[ws]/documents/[...path]').test('/o/a/w/b/documents/x/y.md')).toBe(true)
  })

  it('fits a UI to an API of the same major version and no older minor', () => {
    expect(compatible('1.0', '1.0')).toBe(true)
    expect(compatible('1.0', '1.3')).toBe(true)
    expect(compatible('1.2', '1.1')).toBe(false)
    expect(compatible('1.0', '2.0')).toBe(false)
    expect(compatible('2.0', '1.9')).toBe(false)
  })

  describe('serving a build', () => {
    let outer: string
    let dir: string
    let server: Server
    let base: string

    beforeAll(async () => {
      outer = mkdtempSync(join(tmpdir(), 'docket-ui-'))
      dir = join(outer, 'site')
      mkdirSync(join(dir, '_ui', 'immutable'), { recursive: true })
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Docket</title>')
      writeFileSync(join(dir, 'favicon.svg'), '<svg/>')
      writeFileSync(join(dir, '_ui', 'immutable', 'app.js'), 'export {}')
      writeFileSync(join(dir, '_ui', 'manifest.json'), JSON.stringify({ name: '@docket/cloud-ui', version: '0.1.0', api: '1.0', routes: ['/o/[org]/w/[ws]/access'] }))
      writeFileSync(join(outer, 'secret.txt'), 'not the UI')
      const web = webUi(dir, { frameAncestors: 'http://localhost:4310' })
      if (!web) throw new Error('no UI')
      server = createServer((req, res) => {
        if (web.handles((req.url ?? '/').split('?')[0] ?? '/')) web.serve(req, res)
        else res.writeHead(418).end('the server')
      })
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    afterAll(() => {
      server.close()
      rmSync(outer, { recursive: true, force: true })
    })

    it("answers the UI's pages with its one page, framed only where allowed", async () => {
      const response = await fetch(`${base}/o/acme/w/platform/access?tab=1`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toMatch(/text\/html/)
      expect(response.headers.get('content-security-policy')).toBe('frame-ancestors http://localhost:4310')
      expect(response.headers.get('cache-control')).toBe('no-cache')
      expect(await response.text()).toContain('<title>Docket</title>')
    })

    it('serves its files, the hashed ones for good', async () => {
      const asset = await fetch(`${base}/_ui/immutable/app.js`)
      expect(asset.status).toBe(200)
      expect(asset.headers.get('content-type')).toMatch(/javascript/)
      expect(asset.headers.get('cache-control')).toMatch(/immutable/)
      expect((await fetch(`${base}/favicon.svg`)).status).toBe(200)
      expect((await fetch(`${base}/_ui/manifest.json`)).headers.get('cache-control')).toBe('no-cache')
      expect((await fetch(`${base}/_ui/immutable/missing.js`)).status).toBe(404)
    })

    it('never serves a file outside its build', async () => {
      expect((await fetch(`${base}/_ui/..%2f..%2fsecret.txt`)).status).toBe(404)
      expect((await fetch(`${base}/_ui/%E0%A4%A`)).status).toBe(404)
    })

    it('leaves every other address to the server, and takes only GET on its pages', async () => {
      expect((await fetch(`${base}/o/acme/w/platform/overview`)).status).toBe(418)
      expect((await fetch(`${base}/api/v1/session`)).status).toBe(418)
      const post = await fetch(`${base}/o/acme/w/platform/access`, { method: 'POST', body: 'x' })
      expect(post.status).toBe(405)
      expect(post.headers.get('allow')).toBe('GET, HEAD')
    })

    it('is not there without a build', () => {
      expect(webUi(join(dir, 'nothing'))).toBeNull()
    })
  })
})
