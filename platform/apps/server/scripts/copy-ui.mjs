// SPDX-License-Identifier: AGPL-3.0-only
// Copies the built web UI (packages/docket-ui/cloud) into ui/ beside the server: its site into ui/site and
// the module that serves it into ui/serve.js, where front.js finds them. The server ships them, so the web UI
// and the API it calls upgrade together. Fails rather than build a server whose pages have nothing to serve.
import { cp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cloud = fileURLToPath(new URL('../../../../packages/docket-ui/cloud/', import.meta.url))
const ui = fileURLToPath(new URL('../ui/', import.meta.url))
if (!existsSync(`${cloud}build/_ui/manifest.json`)) {
  console.error(`No built web UI at ${cloud}build. Build the workspace with \`pnpm build\` at the repository root, or \`pnpm --filter @docket/cloud-ui build\` first.`)
  process.exit(1)
}
await rm(ui, { recursive: true, force: true })
await cp(`${cloud}build/`, `${ui}site/`, { recursive: true })
await cp(`${cloud}serve.js`, `${ui}serve.js`)
