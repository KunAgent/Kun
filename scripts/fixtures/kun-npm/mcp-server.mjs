// Deliberately self-contained: no SDK, repository or account dependency.
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { lifecycleParticipant } from './lifecycle-process.mjs'
const lifecycleRoot = process.argv[process.argv.indexOf('--lifecycle-root') + 1]
const lifecycle = process.argv.includes('--lifecycle-root')
  ? await lifecycleParticipant(lifecycleRoot, 'mcp', true) : undefined
const descendant = !lifecycle && process.argv.includes('--with-descendant')
  ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }) : undefined
const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  let result = {}
  if (request.method === 'initialize') result = {
    protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'artifact-fixture', version: '1.0.0' }
  }
  if (request.method === 'tools/list') result = { tools: [{ name: 'fixture_echo',
    description: 'Return the deterministic artifact fixture value.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] }
  if (request.method === 'tools/call') result = { content: [
    { type: 'text', text: 'artifact-mcp:' + request.params.arguments.value + ' mcp-pid:' + process.pid +
      (descendant || lifecycle?.child ? ' mcp-child:' + (descendant?.pid ?? lifecycle.child) : '') }
  ] }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
})
lines.on('close', () => { if (lifecycle) void lifecycle.close('stdin-end'); else process.exit(0) })
