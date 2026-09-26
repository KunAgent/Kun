import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { runMcpBridgeCommand } from './mcp-bridge-cli.js'

function makeIo(lines: string[], handler?: (url: string, init: RequestInit) => Promise<Response>) {
  const stdout: string[] = []
  const stderr: string[] = []
  const requests: Array<{ url: string; auth: string | null; body: string }> = []
  const io = {
    stdin: Readable.from(lines),
    stdout: { write: (chunk: string) => stdout.push(chunk) },
    stderr: { write: (chunk: string) => stderr.push(chunk) },
    env: { KUN_TOOLS_TOKEN: 'kgw_testtoken.sig' } as Record<string, string | undefined>,
    fetch: (async (url: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.authorization ?? null,
        body: String(init?.body ?? '')
      })
      if (handler) return handler(String(url), init ?? {})
      const parsed = JSON.parse(String(init?.body)) as { id?: unknown }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as typeof fetch
  }
  return { io, stdout, stderr, requests }
}

describe('kun mcp-bridge', () => {
  it('requires --token-env and refuses a missing token variable', async () => {
    const missing = makeIo([])
    expect(await runMcpBridgeCommand(['--url', 'http://x/mcp/kun'], missing.io)).toBe(64)
    expect(missing.stderr.join('')).toContain('--token-env')

    const unset = makeIo([])
    unset.io.env = {}
    expect(await runMcpBridgeCommand(['--token-env', 'KUN_TOOLS_TOKEN'], unset.io)).toBe(64)
    expect(unset.stderr.join('')).toContain('KUN_TOOLS_TOKEN')
  })

  it('forwards each stdio line and writes responses back in order', async () => {
    const { io, stdout, requests } = makeIo([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'
    ])
    const code = await runMcpBridgeCommand(
      ['--token-env', 'KUN_TOOLS_TOKEN', '--url', 'http://127.0.0.1:9/mcp/kun'],
      io
    )
    expect(code).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests[0].url).toBe('http://127.0.0.1:9/mcp/kun')
    expect(requests[0].auth).toBe('Bearer kgw_testtoken.sig')
    expect(requests[1].auth).toBe('Bearer kgw_testtoken.sig')
    const replies = stdout.join('').trim().split('\n').map((line) => JSON.parse(line))
    expect(replies).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, result: {} }
    ])
  })

  it('keeps the token out of argv and uses the env default URL', async () => {
    const argv = ['--token-env', 'KUN_TOOLS_TOKEN']
    const { io, requests } = makeIo(
      ['{"jsonrpc":"2.0","id":1,"method":"ping"}\n'],
      async () => new Response('{}', { status: 200 })
    )
    io.env.KUN_MCP_URL = 'http://10.0.0.2:7777/mcp/kun'
    expect(await runMcpBridgeCommand(argv, io)).toBe(0)
    expect(requests[0].url).toBe('http://10.0.0.2:7777/mcp/kun')
    expect(argv.join(' ')).not.toContain('kgw_')
  })

  it('writes a JSON-RPC error for unparseable stdin lines', async () => {
    const { io, stdout } = makeIo(['not json\n'])
    expect(await runMcpBridgeCommand(['--token-env', 'KUN_TOOLS_TOKEN'], io)).toBe(0)
    const reply = JSON.parse(stdout.join('').trim())
    expect(reply.error.code).toBe(-32700)
    expect(reply.id).toBeNull()
  })

  it('stays silent for 202 notification acknowledgements', async () => {
    const { io, stdout, requests } = makeIo(
      ['{"jsonrpc":"2.0","method":"notifications/initialized"}\n'],
      async () => new Response(null, { status: 202 })
    )
    expect(await runMcpBridgeCommand(['--token-env', 'KUN_TOOLS_TOKEN'], io)).toBe(0)
    expect(requests).toHaveLength(1)
    expect(stdout.join('')).toBe('')
  })

  it('forwards server JSON-RPC errors and synthesizes one for HTTP failures', async () => {
    const { io, stdout } = makeIo(
      [
        '{"jsonrpc":"2.0","id":1,"method":"bogus"}\n',
        '{"jsonrpc":"2.0","id":2,"method":"ping"}\n'
      ],
      async (_url, init) => {
        const parsed = JSON.parse(String(init.body)) as { id?: number }
        if (parsed.id === 1) {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no method' } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
        return new Response('oops', { status: 503 })
      }
    )
    expect(await runMcpBridgeCommand(['--token-env', 'KUN_TOOLS_TOKEN'], io)).toBe(0)
    const replies = stdout.join('').trim().split('\n').map((line) => JSON.parse(line))
    expect(replies[0].error.code).toBe(-32601)
    expect(replies[1].error.code).toBe(-32603)
    expect(replies[1].error.message).toContain('503')
  })
})
