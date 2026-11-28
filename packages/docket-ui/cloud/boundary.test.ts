// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { build } from 'vite'
import { describe, expect, it } from 'vitest'

import { PLATFORM_LIB, SRC, boundary, refusal } from './boundary.js'

const page = join(SRC, 'routes', 'o', '[org]', 'w', '[ws]', 'access', '+page.svelte')
const shared = join(PLATFORM_LIB, 'components', 'shell', 'app-shell.svelte')

describe("the web UI's build boundary", () => {
  it('lets the UI import the client side: Svelte, SvelteKit, its icons, its own modules and the server\'s client modules', () => {
    for (const source of ['svelte', 'svelte/reactivity', '@sveltejs/kit', '$app/state', '$app/navigation', '@lucide/svelte', '@fontsource-variable/geist/wght.css', '$lib/api', '$platform/components/avatar.svelte', '@docket/api', '@docket/platform-tenancy/roles', './submit']) {
      expect(refusal(source, page), source).toBeNull()
    }
    expect(refusal('$lib/theme', shared, join(PLATFORM_LIB, 'theme.ts'))).toBeNull()
  })

  it("refuses the server's own code, by name or by where it resolves", () => {
    expect(refusal('$platform/server/runtime', page)).toMatch(/server's own code/)
    expect(refusal('$lib/server/request', page)).toMatch(/server's own code/)
    expect(refusal('$lib/server/request', shared)).toMatch(/server's own code/)
    expect(refusal('../server/request', shared, join(PLATFORM_LIB, 'server', 'request.ts'))).toMatch(/server's own code/)
    expect(refusal('./+page.server', page)).toMatch(/server-only module/)
    expect(refusal('../+layout.server.js', shared, join(PLATFORM_LIB, '..', 'routes', 'o', '[org]', '+layout.server.ts'))).toMatch(/server/)
  })

  it("refuses server-only modules: Node's, SvelteKit's private environment, the server's packages and unknown packages", () => {
    expect(refusal('node:crypto', page)).toMatch(/Node module/)
    expect(refusal('fs', shared)).toMatch(/Node module/)
    expect(refusal('$env/dynamic/private', page)).toMatch(/only on the server/)
    expect(refusal('$app/server', page)).toMatch(/only on the server/)
    expect(refusal('@docket/platform-tenancy', page)).toMatch(/server package/)
    expect(refusal('@docket/platform-auth', shared)).toMatch(/server package/)
    expect(refusal('@chrisjowen/docket', shared)).toMatch(/server package/)
    expect(refusal('pg', page)).toMatch(/does not allow/)
    expect(refusal('@sveltejs/kit/node', page)).toMatch(/Node adapter/)
  })

  it("leaves packages' own imports, and tests', alone", () => {
    expect(refusal('vitest', join(SRC, 'lib', 'views.test.ts'))).toBeNull()
    expect(refusal('node:fs', '/repo/node_modules/.pnpm/vite/node_modules/vite/dist/index.js')).toBeNull()
    expect(refusal('pg', undefined)).toBeNull()
  })

  it('fails a real build that imports server code', async () => {
    const dir = mkdtempSync(join(SRC, 'lib', '.boundary-'))
    try {
      const entry = join(dir, 'entry.ts')
      writeFileSync(entry, "import { getRuntime } from '$platform/server/runtime'\nconsole.log(getRuntime)\n")
      await expect(
        build({
          configFile: false,
          logLevel: 'silent',
          plugins: [boundary()],
          resolve: { alias: { $platform: PLATFORM_LIB } },
          build: { write: false, lib: { entry, formats: ['es'], fileName: 'entry' } },
        }),
      ).rejects.toThrow(/entry\.ts imports platform\/apps\/server\/src\/lib\/server\/runtime.*the server's own code, which the web UI may not import/s)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
