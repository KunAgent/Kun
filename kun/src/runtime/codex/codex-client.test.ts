import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { JsonRpcPeer } from '../../session/jsonrpc-peer.js'
import type { JsonlTransport } from '../../session/jsonl-transport.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import { CodexClient } from './codex-client.js'
import {
  CODEX_APP_SERVER_MIN_VERSION,
  CODEX_CLIENT_METHODS,
  CODEX_DECLINED_SERVER_REQUESTS,
  CODEX_NOTIFICATIONS,
  CODEX_SERVER_REQUESTS
} from './codex-protocol.js'
import type { HarnessProcess } from '../../session/harness-process.js'

const snapshot = JSON.parse(
  readFileSync(
    join(
      fileURLToPath(new URL('.', import.meta.url)),
      'protocol/snapshot.json'
    ),
    'utf8'
  )
) as {
  version: string
  clientRequests: string[]
  clientNotifications: string[]
  serverRequests: string[]
  serverNotifications: string[]
}

describe('codex protocol snapshot', () => {
  it('was generated from a supported codex-cli', () => {
    const [maj, min] = snapshot.version.split('.').map(Number)
    const [reqMaj, reqMin] = CODEX_APP_SERVER_MIN_VERSION.split('.').map(Number)
    expect(maj > reqMaj || (maj === reqMaj && min >= reqMin)).toBe(true)
  })

  it('covers every client method Kun calls', () => {
    for (const method of Object.values(CODEX_CLIENT_METHODS)) {
      expect(snapshot.clientRequests).toContain(method)
    }
  })

  it('covers every server request Kun answers or declines', () => {
    for (const method of Object.values(CODEX_SERVER_REQUESTS)) {
      expect(snapshot.serverRequests).toContain(method)
    }
    for (const method of CODEX_DECLINED_SERVER_REQUESTS) {
      expect(snapshot.serverRequests).toContain(method)
    }
  })

  it('covers every notification Kun consumes', () => {
    for (const method of Object.values(CODEX_NOTIFICATIONS)) {
      expect(snapshot.serverNotifications).toContain(method)
    }
  })
})

/** Controllable in-memory transport for CodexClient tests. */
function fakePeer() {
  const frames: ((value: unknown, raw: string) => void)[] = []
  const writes: unknown[] = []
  const transport = {
    closed: false,
    onFrame: (h: (value: unknown, raw: string) => void) => {
      frames.push(h)
      return () => undefined
    },
    onClose: () => () => undefined,
    write: (value: unknown) => {
      writes.push(value)
      return Promise.resolve()
    }
  } as unknown as JsonlTransport
  const peer = new JsonRpcPeer(transport)
  return {
    peer,
    writes,
    emit: (value: unknown) => frames.forEach((h) => h(value, JSON.stringify(value)))
  }
}

function fakeProcess(): HarnessProcess {
  return {
    stdin: undefined,
    stdout: undefined,
    exit: new Promise(() => undefined),
    stderrTail: () => '',
    sanitizedStderrTail: () => '',
    stop: () => Promise.resolve()
  } as unknown as HarnessProcess
}

function newClient() {
  const { peer, writes, emit } = fakePeer()
  const client = new CodexClient({ process: fakeProcess(), peer })
  return { client, writes, emit }
}

/** Respond to the last outbound request frame. */
function respondToLast(
  writes: unknown[],
  emit: (v: unknown) => void,
  result: unknown
) {
  const frame = writes.at(-1) as { id: number }
  emit({ id: frame.id, result })
}

describe('CodexClient', () => {
  it('performs the initialize handshake then sends initialized', async () => {
    const { client, writes, emit } = newClient()
    const promise = client.initialize()
    respondToLast(writes, emit, {
      codexHome: '/home/u/.codex',
      platformFamily: 'unix',
      platformOs: 'macos',
      userAgent: 'codex-cli/0.145.0'
    })
    const result = await promise
    expect(result.codexHome).toBe('/home/u/.codex')
    const notify = writes.at(-1) as { method?: string }
    expect(notify.method).toBe('initialized')
  })

  it('rejects an initialize response missing required fields', async () => {
    const { client, writes, emit } = newClient()
    const promise = client.initialize()
    respondToLast(writes, emit, { platformOs: 'macos' })
    await expect(promise).rejects.toBeInstanceOf(HarnessTransportError)
  })

  it('parses thread/start responses into CodexThread', async () => {
    const { client, writes, emit } = newClient()
    const promise = client.threadStart({ cwd: '/repo', model: 'gpt-5' })
    respondToLast(writes, emit, {
      thread: { id: 'th_1', status: 'idle', turns: [] },
      model: 'gpt-5',
      modelProvider: 'openai',
      cwd: '/repo',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: { type: 'workspaceWrite' }
    })
    const thread = await promise
    expect(thread.id).toBe('th_1')
    const sent = writes.at(-1) as { method: string }
    expect(sent.method).toBe('thread/start')
  })

  it('fans notifications out to per-method subscribers', async () => {
    const { client, emit } = newClient()
    const deltas: string[] = []
    client.onNotification('item/agentMessage/delta', (_m, params) => {
      deltas.push((params as { delta: string }).delta)
    })
    emit({ method: 'item/agentMessage/delta', params: { delta: 'a' } })
    emit({ method: 'turn/started', params: {} })
    emit({ method: 'item/agentMessage/delta', params: { delta: 'b' } })
    expect(deltas).toEqual(['a', 'b'])
  })

  it('routes inbound approval requests through onRequest', async () => {
    const { client, emit, writes } = newClient()
    client.onRequest(async (method) => {
      if (method === 'item/commandExecution/requestApproval') {
        return { decision: 'accept' }
      }
      throw new HarnessTransportError('harness_protocol_error', 'nope')
    })
    emit({
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 't', turnId: 'tu', itemId: 'i' }
    })
    await new Promise((r) => setImmediate(r))
    const response = writes.at(-1) as { id: string; result?: unknown }
    expect(response.id).toBe('srv-1')
    expect(response.result).toEqual({ decision: 'accept' })
  })

  it('answers unhandled inbound requests with method-not-found', async () => {
    const { client, emit, writes } = newClient()
    emit({ id: 'srv-9', method: 'item/tool/call', params: {} })
    await new Promise((r) => setImmediate(r))
    const response = writes.at(-1) as { id: string; error?: { code: number } }
    expect(response.id).toBe('srv-9')
    expect(response.error?.code).toBe(-32601)
  })
})
