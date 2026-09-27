import { KUN_VERSION } from '../../version.js'
import type { HarnessTokenGrant } from '../../harness/harness-token-service.js'
import { mapKunResultToSdkContent } from '../../runtime/agent-sdk/sdk-tool-bridge.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Minimal streamable-HTTP MCP server exposing Kun's bridged tools to spawned
 * harnesses (docs/ade/05 §3.3). No MCP SDK dependency: the surface is the
 * JSON-RPC subset a harness needs to enumerate and call Kun tools. Execution
 * goes through the shared KunToolBridgeHost — and therefore through the
 * canonical ToolHost — so approval, sandbox, skill, and plan semantics are
 * identical to the in-process SDK bridges. The protocol layer never
 * auto-approves or bypasses policy.
 *
 * Route: `POST /mcp/kun` (`GET` answers 405 — no server-push stream). Auth is
 * a `kgw_` bearer token carrying the `kun-tools` scope; the grant pins the
 * thread and every call lands on that thread's currently running turn.
 */

/** Streamable-HTTP-capable revisions this endpoint can negotiate. */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  '2025-03-26',
  '2025-06-18',
  '2025-11-25'
] as const

const MCP_BODY_LIMIT_BYTES = 1024 * 1024
const JSON_RPC = '2.0'
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const NO_ACTIVE_TURN = -32000

type JsonRpcId = string | number

type JsonRpcMessage = {
  jsonrpc?: unknown
  id?: JsonRpcId | null
  method?: unknown
  params?: unknown
}

type JsonRpcResponseBody =
  | { jsonrpc: typeof JSON_RPC; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: typeof JSON_RPC; id: JsonRpcId | null; error: { code: number; message: string } }

function rpcResult(id: JsonRpcId | null, result: unknown): JsonResponse {
  const body: JsonRpcResponseBody = { jsonrpc: JSON_RPC, id: id ?? null, result }
  return jsonResponse(body)
}

function rpcError(id: JsonRpcId | null, code: number, message: string): JsonResponse {
  const body: JsonRpcResponseBody = { jsonrpc: JSON_RPC, id: id ?? null, error: { code, message } }
  return jsonResponse(body)
}

function bearer(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The turn MCP calls attach to: the thread's running, admitted turn. */
function activeTurn(thread: ThreadRecord | null): ThreadRecord['turns'][number] | undefined {
  return thread?.turns.find((turn) => turn.status === 'running' && !turn.admissionPending)
}

function mcpToolList(
  tools: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[]
): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }
}

export async function handleKunToolsMcp(
  runtime: ServerRuntime,
  request: Request
): Promise<Response | JsonResponse> {
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed', message: 'method not allowed' }, 405)
  }
  const tokens = runtime.harnessTokens
  const host = runtime.kunToolBridge
  if (!tokens || !host) {
    return jsonResponse({ code: 'unavailable', message: 'kun tools MCP server is not enabled' }, 503)
  }
  const grant = tokens.verifyScope(bearer(request), 'kun-tools')
  if (!grant) {
    return jsonResponse({ code: 'unauthorized', message: 'unauthorized' }, 401)
  }

  const body = await readJsonBody(request, MCP_BODY_LIMIT_BYTES)
  if (!body.ok) return body.response
  const message: unknown = body.value
  // Batch requests are rejected outright: a batch would let several calls
  // share one credential check and muddy per-request identity.
  if (Array.isArray(message)) {
    return rpcError(null, INVALID_REQUEST, 'JSON-RPC batch requests are not supported')
  }
  if (!isRecord(message) || typeof message.method !== 'string') {
    return rpcError(null, PARSE_ERROR, 'expected a JSON-RPC message object')
  }

  // Notifications carry no id and can never receive a response document; any
  // id-less message — initialized, cancelled, unknown — is acknowledged.
  if (message.id === undefined) {
    return new Response(null, { status: 202 })
  }
  if (message.id !== null && typeof message.id !== 'string' && typeof message.id !== 'number') {
    return rpcError(null, INVALID_REQUEST, 'request id must be a string or number')
  }
  const id = message.id

  switch (message.method) {
    case 'initialize': {
      const requested = isRecord(message.params) ? message.params.protocolVersion : undefined
      const protocolVersion =
        typeof requested === 'string' &&
        (SUPPORTED_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : SUPPORTED_MCP_PROTOCOL_VERSIONS[SUPPORTED_MCP_PROTOCOL_VERSIONS.length - 1]
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kun', version: KUN_VERSION }
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
    case 'tools/call':
      return handleToolMethod(runtime, host, grant, id, message)
    default:
      return rpcError(id, METHOD_NOT_FOUND, `method not found: ${message.method}`)
  }
}

async function handleToolMethod(
  runtime: ServerRuntime,
  host: NonNullable<ServerRuntime['kunToolBridge']>,
  grant: HarnessTokenGrant,
  id: JsonRpcId | null,
  message: JsonRpcMessage
): Promise<JsonResponse> {
  const thread = await runtime.threadService.get(grant.threadId)
  const turn = activeTurn(thread)
  if (message.method === 'tools/list') {
    if (!turn) return rpcError(id, NO_ACTIVE_TURN, 'no active turn for this session')
    const tools = await host.listTools(grant.threadId, turn.id)
    return rpcResult(id, mcpToolList(tools))
  }

  const params = isRecord(message.params) ? message.params : undefined
  const toolName = typeof params?.name === 'string' ? params.name : ''
  if (!toolName) return rpcError(id, INVALID_PARAMS, 'tools/call requires a tool name')
  if (!turn) {
    // A tool-level error (not a protocol error): the session is valid, the
    // call simply has no live turn to execute inside.
    return rpcResult(
      id,
      mapKunResultToSdkContent({
        output: 'no active turn for this session; tool call was not executed',
        isError: true
      })
    )
  }
  const args = isRecord(params?.arguments) ? params.arguments : {}
  const signal =
    runtime.turnService.getAbortController(turn.id) ?? new AbortController().signal
  const result = await host.execute(grant.threadId, turn.id, {
    toolName,
    args,
    callId: `mcp_${String(id)}`,
    signal
  })
  return rpcResult(id, mapKunResultToSdkContent(result))
}
