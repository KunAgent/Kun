import { describe, expect, it, vi } from 'vitest'
import { buildRouter } from './index.js'
import { dispatchRequest } from '../http-server.js'
import { Router } from '../router.js'
import { makeKgwTokenGuard } from '../kgw-token-guard.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  HARNESS_TOKEN_PREFIX,
  HarnessTokenService
} from '../../harness/harness-token-service.js'
import {
  createKunToolBridgeHost,
  type KunToolBridgeHost
} from '../../harness/kun-tool-bridge-host.js'
import { createWorkerCallbackToolProvider } from '../../adapters/tool/worker-callback-tool-provider.js'
import type { WorkerCallbackService } from '../../services/worker-callback-service.js'
import type { CapabilityToolSpec } from '../../adapters/tool/capability-registry.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { ToolHost, ToolHostContext } from '../../ports/tool-host.js'
import type { ApprovalRequest } from '../../domain/approval.js'

const NOW = '2026-01-01T00:00:00.000Z'

type FixtureOptions = {
  runningTurn?: boolean
  workerThread?: boolean
  catalog?: CapabilityToolSpec[]
  execute?: ToolHost['execute']
  approvalGate?: { request(approval: ApprovalRequest): Promise<'allow' | 'deny'> }
}

function makeThread(running: boolean, worker = false): ThreadRecord {
  return {
    id: 'thread_1',
    title: 'MCP test',
    workspace: '/workspace',
    model: 'm1',
    status: 'active',
    ...(worker
      ? {
          executionUnit: {
            kind: 'worker',
            teamId: 'thr_mgr',
            managerThreadId: 'thr_mgr',
            label: 'fixer',
            lifecycle: 'persistent',
            control: 'manager'
          }
        }
      : {}),
    turns: [
      {
        id: 'turn_1',
        threadId: 'thread_1',
        status: running ? 'running' : 'completed',
        prompt: 'do the thing',
        actingModelRoute: { model: 'm1', providerId: 'deepseek' }
      }
    ]
  } as unknown as ThreadRecord
}

function makeFixture(options: FixtureOptions = {}) {
  const thread = makeThread(options.runningTurn ?? true, options.workerThread)
  const catalog = options.catalog ?? [
    {
      name: 'memory_search',
      description: 'Search memory',
      inputSchema: { type: 'object', properties: {} }
    },
    // `read` overlaps harness built-ins and must stay out of the listing.
    { name: 'read', description: 'Read a file', inputSchema: { type: 'object' } }
  ] as unknown as CapabilityToolSpec[]
  const abort = new AbortController()
  const toolHost: ToolHost = {
    id: 'fake-tool-host',
    listTools: async () => catalog,
    execute: options.execute ?? (async (call) => ({
      item: { kind: 'tool_result', output: `ran:${call.toolName}`, isError: false },
      approved: false
    }) as never)
  }
  const host = createKunToolBridgeHost({
    threadStore: { get: async (id: string) => (id === thread.id ? thread : null) } as never,
    sessionStore: {} as never,
    registry: {
      listTools: (context?: ToolHostContext) =>
        catalog.filter((tool) => {
          const gate = (
            tool as unknown as {
              shouldAdvertise?: (ctx: ToolHostContext) => boolean
            }
          ).shouldAdvertise
          return !gate || gate(context as ToolHostContext)
        })
    } as never,
    toolHost,
    turns: { applyItem: async () => {}, updateItem: async () => {} } as never,
    events: { record: async () => undefined } as never,
    ids: { next: (prefix: string) => `${prefix}_1` },
    approvalGate: options.approvalGate as never,
    defaultApprovalPolicy: 'on-request',
    defaultSandboxMode: 'workspace-write',
    defaultApprovalReviewer: 'user',
    nowIso: () => NOW
  })
  const tokens = new HarnessTokenService()
  const token = tokens.issue({
    threadId: thread.id,
    harnessId: 'gemini-cli',
    credentialIdentity: 'cred:test',
    scopes: ['kun-tools']
  })
  const runtime = {
    runtimeToken: 'runtime-token',
    insecure: false,
    nowIso: () => NOW,
    allocateSeq: () => 1,
    harnessTokens: tokens,
    kunToolBridge: host,
    threadService: { get: async (id: string) => (id === thread.id ? thread : null) },
    turnService: { getAbortController: (id: string) => (id === 'turn_1' ? abort.signal : undefined) }
  } as unknown as ServerRuntime
  return { runtime, tokens, token, host, thread, toolHost, abort }
}

function rpc(method: string, params?: unknown, id: string | number = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })
}

async function post(
  runtime: ServerRuntime,
  body: string,
  token?: string
): Promise<{ status: number; json: () => Promise<any> }> {
  const router = buildRouter(runtime)
  const match = router.match('POST', '/mcp/kun')
  if (!match) throw new Error('route not registered')
  const response = await match.handler(
    new Request('http://127.0.0.1/mcp/kun', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body
    }),
    { params: {} }
  )
  const res = response instanceof Response ? response : new Response(response.body, { status: response.status })
  return { status: res.status, json: async () => JSON.parse(await res.text()) }
}

describe('kun tools MCP route', () => {
  it('rejects missing, malformed, and wrongly-scoped tokens with 401', async () => {
    const { runtime, tokens } = makeFixture()
    expect((await post(runtime, rpc('ping'))).status).toBe(401)
    expect((await post(runtime, rpc('ping'), 'kgw_deadbeef.badsig')).status).toBe(401)
    const gatewayOnly = tokens.issue({
      threadId: 'thread_1',
      harnessId: 'gemini-cli',
      credentialIdentity: 'cred:test',
      scopes: ['gateway']
    })
    expect((await post(runtime, rpc('ping'), gatewayOnly)).status).toBe(401)
    expect((await post(runtime, rpc('ping'), 'not-a-token')).status).toBe(401)
  })

  it('answers 405 to GET /mcp/kun', async () => {
    const { runtime, token } = makeFixture()
    const router = buildRouter(runtime)
    const match = router.match('GET', '/mcp/kun')
    if (!match) throw new Error('GET /mcp/kun not registered')
    const response = await match.handler(
      new Request('http://127.0.0.1/mcp/kun', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
      }),
      { params: {} }
    )
    const res = response instanceof Response ? response : new Response(response.body, { status: response.status })
    expect(res.status).toBe(405)
  })

  it('negotiates a supported protocol version and falls back to the newest', async () => {
    const { runtime, token } = makeFixture()
    const supported = await post(runtime, rpc('initialize', { protocolVersion: '2025-06-18' }), token)
    const supportedBody = await supported.json()
    expect(supportedBody.result.protocolVersion).toBe('2025-06-18')
    expect(supportedBody.result.serverInfo.name).toBe('kun')
    expect(supportedBody.result.capabilities.tools.listChanged).toBe(false)

    const fallback = await post(runtime, rpc('initialize', { protocolVersion: '1999-01-01' }), token)
    expect((await fallback.json()).result.protocolVersion).toBe('2025-11-25')
  })

  it('acknowledges notifications with 202 and no body', async () => {
    const { runtime, token } = makeFixture()
    const router = buildRouter(runtime)
    const match = router.match('POST', '/mcp/kun')!
    const response = await match.handler(
      new Request('http://127.0.0.1/mcp/kun', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      }),
      { params: {} }
    )
    const res = response instanceof Response ? response : new Response(response.body, { status: response.status })
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('rejects JSON-RPC batches and unknown methods', async () => {
    const { runtime, token } = makeFixture()
    const batch = await post(
      runtime,
      `[${rpc('ping', undefined, 1)},${rpc('ping', undefined, 2)}]`,
      token
    )
    expect((await batch.json()).error.code).toBe(-32600)

    const unknown = await post(runtime, rpc('resources/list'), token)
    expect((await unknown.json()).error.code).toBe(-32601)

    const pong = await post(runtime, rpc('ping', undefined, 'p1'), token)
    expect(await pong.json()).toEqual({ jsonrpc: '2.0', id: 'p1', result: {} })
  })

  it('lists the same bridged tools the SDK path exposes for the turn', async () => {
    const { runtime, token, host } = makeFixture()
    const direct = await host.listTools('thread_1', 'turn_1')
    const listed = await post(runtime, rpc('tools/list', undefined, 'l1'), token)
    const body = await listed.json()
    expect(body.id).toBe('l1')
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      direct.map((tool) => tool.name)
    )
    // Overlap exclusion is preserved end-to-end: `read` never reaches the wire.
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain('memory_search')
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).not.toContain('read')
  })

  it('returns a tool error when no turn is running', async () => {
    const { runtime, token } = makeFixture({ runningTurn: false })
    const called = await post(
      runtime,
      rpc('tools/call', { name: 'memory_search', arguments: {} }, 'c1'),
      token
    )
    const body = await called.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('no active turn')
    const listed = await post(runtime, rpc('tools/list', undefined, 'l1'), token)
    expect((await listed.json()).error.code).toBe(-32000)
  })

  it('executes tools/call through the shared host with the turn signal', async () => {
    const calls: Array<{ callId: string; toolName: string }> = []
    const { runtime, token } = makeFixture({
      execute: async (call, _context) => {
        calls.push({ callId: call.callId, toolName: call.toolName })
        return {
          item: { kind: 'tool_result', output: `ok:${call.toolName}`, isError: false },
          approved: false
        } as never
      }
    })
    const response = await post(
      runtime,
      rpc('tools/call', { name: 'memory_search', arguments: { query: 'q' } }, 9),
      token
    )
    const body = await response.json()
    expect(body.result.isError).toBeUndefined()
    expect(body.result.content[0].text).toBe('ok:memory_search')
    expect(calls).toEqual([{ callId: 'mcp_9', toolName: 'memory_search' }])
  })

  it('routes approval-needing calls through the approval gate', async () => {
    const request = vi.fn(async () => 'allow' as const)
    const { runtime, token } = makeFixture({
      approvalGate: { request } as never,
      execute: async (_call, context: ToolHostContext) => {
        const decision = await context.awaitApproval({
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolName: 'memory_search',
          summary: 'needs approval'
        } as ApprovalRequest)
        return {
          item: { kind: 'tool_result', output: `decision:${decision}`, isError: false },
          approved: true
        } as never
      }
    })
    const response = await post(
      runtime,
      rpc('tools/call', { name: 'memory_search', arguments: {} }, 'a1'),
      token
    )
    const body = await response.json()
    expect(request).toHaveBeenCalledOnce()
    expect(body.result.content[0].text).toBe('decision:allow')
  })
})

  it('delivers a worker submit_result call to the callback service (P3-08)', async () => {
    const calls: Array<{ threadId: string; args: unknown }> = []
    const service = {
      reportProgress: async () => ({ status: 'recorded' }),
      askManager: async () => ({ status: 'answered' }),
      readManagerContext: async () => ({ context: '' }),
      submitResult: async (threadId: string, args: unknown) => {
        calls.push({ threadId, args })
        return { status: 'recorded' }
      }
    }
    const provider = createWorkerCallbackToolProvider(
      service as unknown as WorkerCallbackService
    )
    const { runtime, token } = makeFixture({
      workerThread: true,
      catalog: provider.tools as unknown as CapabilityToolSpec[],
      execute: async (call, ctx) => {
        const tool = provider.tools.find((entry) => entry.name === call.toolName)
        const result = await (
          tool as unknown as {
            execute: (
              args: Record<string, unknown>,
              ctx: ToolHostContext
            ) => Promise<{ output: unknown }>
          }
        ).execute((call.arguments ?? {}) as Record<string, unknown>, ctx)
        return {
          item: { kind: 'tool_result', output: result.output, isError: false },
          approved: false
        } as never
      }
    })

    // The worker-gated tool is advertised to the MCP caller…
    const listed = await post(runtime, rpc('tools/list'), token)
    const tools = (await listed.json()).result.tools as Array<{ name: string }>
    expect(tools.map((tool) => tool.name)).toContain('submit_result')

    // …and tools/call lands on WorkerCallbackService with the worker thread.
    const called = await post(
      runtime,
      rpc('tools/call', {
        name: 'submit_result',
        arguments: { summary: 'fixed the redirect', outcome: 'succeeded' }
      }),
      token
    )
    expect(called.status).toBe(200)
    const content = (await called.json()).result.content as Array<{ text: string }>
    expect(content[0].text).toContain('recorded')
    expect(calls).toEqual([
      {
        threadId: 'thread_1',
        args: { summary: 'fixed the redirect', outcome: 'succeeded' }
      }
    ])
  })

  it('hides worker callback tools from a non-worker thread', async () => {
    const provider = createWorkerCallbackToolProvider({
      reportProgress: async () => ({}),
      askManager: async () => ({}),
      readManagerContext: async () => ({}),
      submitResult: async () => ({})
    } as unknown as WorkerCallbackService)
    const { runtime, token } = makeFixture({
      workerThread: false,
      catalog: provider.tools as unknown as CapabilityToolSpec[]
    })
    const listed = await post(runtime, rpc('tools/list'), token)
    const tools = (await listed.json()).result.tools as Array<{ name: string }>
    expect(tools.map((tool) => tool.name)).not.toContain('submit_result')
  })

describe('kgw token guard', () => {
  it('rejects kgw_ tokens outside their scope paths before routing', async () => {
    const tokens = new HarnessTokenService()
    const toolsToken = tokens.issue({
      threadId: 'thread_1',
      harnessId: 'gemini-cli',
      credentialIdentity: 'cred:test',
      scopes: ['kun-tools']
    })
    const guard = makeKgwTokenGuard(tokens)!
    const router = new Router()
    const req = (path: string, token?: string) =>
      new Request(`http://127.0.0.1${path}`, {
        method: 'GET',
        headers: token ? { authorization: `Bearer ${token}` } : {}
      })
    // A kun-tools token has no business on the control plane.
    const denied = await dispatchRequest(router, req('/v1/threads', toolsToken), guard)
    expect(denied.status).toBe(401)
    // Gateway-scoped grants reach only the gateway surface.
    const gatewayToken = tokens.issue({
      threadId: 'thread_1',
      harnessId: 'gemini-cli',
      credentialIdentity: 'cred:test',
      scopes: ['gateway']
    })
    expect((await dispatchRequest(router, req('/v1/messages/count_tokens', gatewayToken), guard)).status).toBe(404)
    expect((await dispatchRequest(router, req('/mcp/kun', gatewayToken), guard)).status).toBe(401)
    // Tampered and non-kgw tokens follow their normal paths.
    expect((await dispatchRequest(router, req('/mcp/kun', `${HARNESS_TOKEN_PREFIX}bad.sig`), guard)).status).toBe(401)
    expect((await dispatchRequest(router, req('/v1/threads'), guard)).status).toBe(404)
    expect((await dispatchRequest(router, req('/v1/threads', 'kun_local_abc'), guard)).status).toBe(404)
  })
})

it('rejects a prior-turn MCP grant even while another turn is running', async () => {
  const execute = vi.fn()
  const f = makeFixture({ execute })
  const token = f.tokens.issue({ threadId: f.thread.id, harnessId: 'gemini-cli',
    credentialIdentity: 'native-session', scopes: ['kun-tools'], turnId: 'previous-turn' })
  const response = await post(f.runtime, rpc('tools/call', { name: 'memory_search', arguments: {} }), token)
  expect((await response.json()).result.isError).toBe(true)
  expect(execute).not.toHaveBeenCalled()
})
