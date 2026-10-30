// Copies the built web UI into dist/ui, where `docket open` serves it from,
// and docket_search's MCP app into dist/mcp-app, where its MCP server reads it.
// Fails rather than ship a package whose `docket open` has nothing to serve.
import { cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const built = [
  { from: '../../docket-ui/build/', file: 'index.html', to: '../dist/ui/', what: 'web UI' },
  { from: '../../docket-ui/mcp-app/', file: 'search.html', to: '../dist/mcp-app/', what: 'search app' }
]

for (const { from, file, to, what } of built) {
  const source = fileURLToPath(new URL(from, import.meta.url))
  if (!existsSync(`${source}${file}`)) {
    console.error(
      `No built ${what} at ${source}. Build the workspace with \`pnpm build\` at the repository root, ` +
        'or `pnpm -C packages/docket-ui build` first.'
    )
    process.exit(1)
  }
  await cp(source, fileURLToPath(new URL(to, import.meta.url)), { recursive: true })
}
