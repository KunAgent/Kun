import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { bindTurnMutationContext, currentTurnMutationFence, runWithTurnMutationFence } from '../manager/turn-mutation-context.js'
import { CodexClient } from '../runtime/codex/codex-client.js'
import { PiClient } from '../runtime/pi/pi-client.js'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { AcpClientHost } from '../runtime/acp/acp-client-host.js'
import { JsonRpcPeer } from './jsonrpc-peer.js'
import type { JsonlTransport } from './jsonl-transport.js'
import type { HarnessProcess } from './harness-process.js'

const first = { threadId: 'thread', turnId: 'first', ownerFlavor: 'development' as const, ownerInstanceId: 'runtime', fencingToken: 1 }
const second = { ...first, turnId: 'second', fencingToken: 2 }
function transport() {
  const frames: ((value: unknown, raw: string) => void)[] = []
  const channel = { closed: false, onFrame: (fn: (v: unknown, raw: string) => void) => { frames.push(fn); return () => undefined },
    onClose: () => () => undefined, write: async () => undefined } as unknown as JsonlTransport
  return { channel, emit: (value: unknown) => runWithTurnMutationFence(first, () => frames.forEach((fn) => fn(value, JSON.stringify(value)))) }
}
const processStub = () => ({ exit: new Promise(() => undefined), sanitizedStderrTail: () => '' }) as unknown as HarnessProcess

describe('reused native transport callbacks', () => {
  it('retains the registered lease without borrowing a later turn authority', () => {
    const callback = runWithTurnMutationFence(first, () => bindTurnMutationContext(() => currentTurnMutationFence()))
    expect(runWithTurnMutationFence(second, callback)).toEqual(first)
    expect(currentTurnMutationFence()).toBeUndefined()
  })
  it('runs Codex notifications under the subscribing turn instead of the process startup turn', () => {
    const channel = transport()
    const client = runWithTurnMutationFence(first, () => new CodexClient({ process: processStub(), peer: new JsonRpcPeer(channel.channel) }))
    let observed: unknown
    const unsubscribe = runWithTurnMutationFence(second, () => client.onNotification('item/agentMessage/delta', () => { observed = currentTurnMutationFence() }))
    channel.emit({ method: 'item/agentMessage/delta', params: { threadId: 'native-thread', turnId: 'native-second', delta: 'second answer' } })
    expect(observed).toEqual(second)
    unsubscribe(); observed = undefined
    channel.emit({ method: 'item/agentMessage/delta', params: {} })
    expect(observed).toBeUndefined()
  })
  it('runs Pi output and approval events under the current subscription lease', () => {
    const channel = transport()
    const client = runWithTurnMutationFence(first, () => new PiClient(processStub(), { transport: channel.channel }))
    const observed: unknown[] = []
    runWithTurnMutationFence(second, () => {
      for (const type of ['message_update', 'extension_ui_request']) client.onEvent(type, () => { observed.push(currentTurnMutationFence()) })
    })
    channel.emit({ type: 'message_update' }); channel.emit({ type: 'extension_ui_request' })
    expect(observed).toEqual([second, second])
  })
  it('rebinds ACP session output and permission callbacks when the connection is reused', async () => {
    const stdin = new PassThrough(), stdout = new PassThrough()
    let exited!: () => void
    const exit = new Promise<{ code: number; signal: null }>((resolve) => { exited = () => resolve({ code: 0, signal: null }) })
    const process = { stdin, stdout, exit, sanitizedStderrTail: () => '', stop: async () => { stdout.end(); exited() } }
    const conn = runWithTurnMutationFence(first, () => AcpConnection.start({ process: process as never, identity: 'fixture' }))
    let observed: unknown
    runWithTurnMutationFence(second, () => conn.subscribeSession('session', { onUpdate: () => { observed = currentTurnMutationFence() } }))
    runWithTurnMutationFence(first, () => stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: 'session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second reply' } }
    } }) + '\n'))
    expect(observed).toEqual(second)
    const handlers = new Map<string, (params: unknown) => unknown>()
    const host = new AcpClientHost()
    host.attach({ rpc: { onRequest: (method: string, handler: (params: unknown) => unknown) => handlers.set(method, handler) } } as never)
    runWithTurnMutationFence(second, () => host.registerContext({ sessionId: 'session', threadId: 'thread', turnId: 'second',
      workspace: '/fixture', readRoots: [], writeRoots: [], approve: async () => { observed = currentTurnMutationFence(); return 'deny' } }))
    observed = undefined
    await runWithTurnMutationFence(first, () => handlers.get('session/request_permission')!({ sessionId: 'session',
      toolCall: { toolCallId: 'call', title: 'Check permission' }, options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }] }))
    expect(observed).toEqual(second)
    host.unregisterContext('session'); await conn.close()
  })
})
