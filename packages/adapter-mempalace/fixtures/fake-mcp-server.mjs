// A stand-in MCP server for the transport tests: newline-delimited JSON-RPC
// over stdio, answering the way MemPalace 3.10.0 frames its answers.
import { createInterface } from 'node:readline'

const reply = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const text = (value) => ({ type: 'text', text: JSON.stringify(value, null, 2) })

process.stderr.write('fake server starting\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'initialize') {
    reply({
      id: request.id,
      result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'mempalace', version: '3.10.0' } }
    })
    return
  }
  const { name, arguments: args } = request.params
  switch (name) {
    case 'echo':
      // A noise line first: the client matches answers by id.
      process.stdout.write('not json\n')
      reply({ id: request.id, result: { content: [text({ echoed: args })] } })
      break
    case 'notice':
      reply({ id: request.id, result: { content: [{ type: 'text', text: '[mempalace] running without its hub' }, text({ ok: true })] } })
      break
    case 'busy':
      reply({ id: request.id, error: { code: -32001, message: 'Another MCP server holds the palace write lease' } })
      break
    case 'env':
      reply({ id: request.id, result: { content: [text({ value: process.env[args.name] ?? null })] } })
      break
    case 'slow':
      break
    case 'exit':
      process.stderr.write('fatal: palace locked\n')
      process.exit(3)
  }
})
