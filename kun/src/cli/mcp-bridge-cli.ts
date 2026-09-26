import { createInterface } from 'node:readline'
import { DEFAULT_SERVE_PORT } from './cli-options.js'

/**
 * `kun mcp-bridge` — stdio ↔ `POST /mcp/kun` forwarder for harnesses that can
 * only spawn MCP servers over stdio (docs/ade/05 §3.3). Each newline-delimited
 * JSON-RPC message read from stdin is forwarded to the Kun server; the JSON
 * response is written back to stdout. The `kgw_` token reaches this process
 * exclusively through the environment variable named by `--token-env` — it is
 * never placed on argv, where any local process could read it.
 */

const USAGE = `kun mcp-bridge --token-env <VAR> [--url <url>]

Forward stdio JSON-RPC to a running Kun server's /mcp/kun endpoint.

Options:
  --token-env <VAR>  Name of the environment variable holding the kgw_ token
  --url <url>        MCP endpoint URL (default: $KUN_MCP_URL or http://127.0.0.1:${DEFAULT_SERVE_PORT}/mcp/kun)
`

const PARSE_ERROR = -32700
const INTERNAL_ERROR = -32603

type BridgeIo = {
  stdin?: NodeJS.ReadableStream
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
}

function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

function messageId(raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null && 'id' in raw) {
    const id = (raw as { id: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') return id
  }
  return null
}

export async function runMcpBridgeCommand(argv: readonly string[], io: BridgeIo): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout.write(USAGE)
    return 0
  }
  const env = io.env ?? process.env
  let tokenEnv: string | undefined
  let url = env.KUN_MCP_URL?.trim() || `http://127.0.0.1:${DEFAULT_SERVE_PORT}/mcp/kun`
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--token-env') {
      tokenEnv = argv[++i]
    } else if (arg === '--url') {
      url = argv[++i] ?? url
    } else if (arg?.startsWith('--token-env=')) {
      tokenEnv = arg.slice('--token-env='.length)
    } else if (arg?.startsWith('--url=')) {
      url = arg.slice('--url='.length)
    } else {
      io.stderr.write(`kun mcp-bridge: unknown argument: ${arg}\n`)
      return 64
    }
  }
  if (!tokenEnv) {
    io.stderr.write('kun mcp-bridge: --token-env <VAR> is required\n')
    return 64
  }
  const token = env[tokenEnv]?.trim()
  if (!token) {
    io.stderr.write(`kun mcp-bridge: environment variable ${tokenEnv} is not set\n`)
    return 64
  }
  const post = io.fetch ?? fetch
  const input = io.stdin ?? process.stdin
  input.resume?.()

  const forward = async (line: string): Promise<void> => {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      io.stdout.write(`${jsonRpcError(null, PARSE_ERROR, 'invalid JSON on stdin')}\n`)
      return
    }
    const id = messageId(parsed)
    try {
      const response = await post(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: line
      })
      if (response.status === 202) return
      const text = await response.text()
      if (response.ok && text) {
        io.stdout.write(`${text}\n`)
        return
      }
      if (text) {
        try {
          // A well-formed JSON-RPC error document forwards verbatim so the
          // client sees the server's own error code/message.
          const doc = JSON.parse(text) as { id?: unknown }
          if (typeof doc === 'object' && doc !== null && 'error' in doc) {
            io.stdout.write(`${JSON.stringify({ ...doc, id: doc.id ?? id })}\n`)
            return
          }
        } catch {
          // fall through to a synthesized error below
        }
      }
      io.stdout.write(
        `${jsonRpcError(id, INTERNAL_ERROR, `kun tools MCP endpoint returned HTTP ${response.status}`)}\n`
      )
    } catch (error) {
      io.stdout.write(
        `${jsonRpcError(id, INTERNAL_ERROR, `kun tools MCP endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`)}\n`
      )
    }
  }

  // Lines are forwarded strictly in order so response ids line up with the
  // client's pipelined requests without an id-correlation map.
  const lines = createInterface({ input, terminal: false })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) await forward(trimmed)
  }
  return 0
}
