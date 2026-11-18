// Another process writing to a project's docket through docket's own local MCP
// server, as `docket open` or a second `docket serve` would: argv is the project
// and how many notes to add; each is one docket_add_evidence call, all at once.
import { createMcpServer } from '@chrisjowen/docket'

const [cwd, count] = process.argv.slice(2)
const server = createMcpServer({ cwd })
const answers = await Promise.all(
  Array.from({ length: Number(count) }, (_, index) =>
    server.handle({
      jsonrpc: '2.0',
      id: index,
      method: 'tools/call',
      params: { name: 'docket_add_evidence', arguments: { id: 'service.orders', evidence: [{ source: 'human', note: `process note ${index}` }] } }
    })
  )
)
const failed = answers.filter((answer) => answer?.result?.isError || answer?.error)
process.stdout.write(JSON.stringify({ written: answers.length - failed.length, failed }))
