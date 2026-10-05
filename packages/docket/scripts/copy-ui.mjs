// Copies the built web UI into dist/ui, where `docket open` serves it from.
// Fails rather than ship a package whose `docket open` has nothing to serve.
import { cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const from = fileURLToPath(new URL('../../docket-ui/build/', import.meta.url))
const to = fileURLToPath(new URL('../dist/ui/', import.meta.url))

if (!existsSync(`${from}index.html`)) {
  console.error(
    `No built web UI at ${from}. Build the workspace with \`pnpm build\` at the repository root, ` +
      'or `pnpm -C packages/docket-ui build` first.'
  )
  process.exit(1)
}

await cp(from, to, { recursive: true })
