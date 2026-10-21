import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteClient, type Socket } from '@kun/remote-protocol'
import { MobileLinkService, type LinkDependencies } from './service'
import { MobileSubscriptions } from './subscriptions'
import { refreshAfterWrite, writtenHistory } from './write-refresh'

const applied = (result: unknown = {}) => ({ receipt: { status: 'applied', result } })
const phone = '22222222-2222-4222-8222-222222222222', grant = '33333333-3333-4333-8333-333333333333'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
afterEach(() => { vi.restoreAllMocks() })

describe('which history a phone write changed', () => {
  it('names the conversation of each applied send and nothing else', () => {
    expect(writtenHistory('code.turn.start', { threadId: 'task' }, applied())).toEqual({ kind: 'code', id: 'task' })
    expect(writtenHistory('execution.queue.enqueue', { threadId: 'task' }, applied())).toEqual({ kind: 'code', id: 'task' })
    expect(writtenHistory('execution.steer', { threadId: 'task', turnId: 'turn' }, applied())).toEqual({ kind: 'code', id: 'task' })
    expect(writtenHistory('agent.message.send', { agentId: 'kun' }, applied())).toEqual({ kind: 'agent', id: 'kun' })
    expect(writtenHistory('code.history', { threadId: 'task' }, applied())).toBeNull()
    expect(writtenHistory('execution.stop', { threadId: 'task' }, applied())).toBeNull()
    expect(writtenHistory('code.turn.start', { threadId: 'task' }, { receipt: { status: 'reconciliation_required' } })).toBeNull()
    expect(writtenHistory('code.turn.start', { threadId: 'task' }, { receipt: { status: 'rejected', error: { code: 'TASK_BUSY' } } })).toBeNull()
    expect(writtenHistory('code.turn.start', {}, applied())).toBeNull()
    expect(writtenHistory('agent.message.send', { threadId: 'task' }, applied())).toBeNull()
  })
})

describe('a live page after the phone writes', () => {
  const page = (latestSeq: number, items: string[]) => ({ id: 'thread', historyVersion: 'v', latestSeq,
    turns: [{ id: 'turn', items: items.map((text, index) => ({ id: 'item-' + index, kind: 'user_message', role: 'user', text })) }] })
  it('re-reads the watched page right away without waiting for a runtime event, and only for that phone and page', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>, current: any = page(9, ['first'])
    const sent: any[] = [], fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { writer = controller } }))) as unknown as typeof fetch
    const read = vi.fn(async (_device: string, _authority: unknown, method: string) => method === 'approval.list' ? undefined : current)
    const service = new MobileSubscriptions({ lease: async () => ({ baseUrl: 'http://runtime.test', runtimeToken: 'runtime', request: vi.fn() }) as any,
      fetch: fetcher, send: (frame) => sent.push(frame), read })
    const authority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'authority', scopes: ['personal'] }
    const watching = service.subscribe('phone', { kind: 'code', id: 'thread', since: 0, live: true }, authority)
    await vi.waitFor(() => expect(sent.some((frame) => frame.payload?.kind === 'subscribed')).toBe(true))
    const reads = () => read.mock.calls.filter(([, , method]) => method === 'code.history').length
    expect(reads()).toBe(1)
    expect(refreshAfterWrite(service, 'other-phone', 'code.turn.start', { threadId: 'thread' }, applied())).toBe(false)
    expect(refreshAfterWrite(service, 'phone', 'code.turn.start', { threadId: 'another' }, applied())).toBe(false)
    current = page(10, ['first', 'second'])
    expect(refreshAfterWrite(service, 'phone', 'code.turn.start', { threadId: 'thread' }, applied())).toBe(true)
    // A burst of writes still costs one read per spacing.
    refreshAfterWrite(service, 'phone', 'execution.queue.enqueue', { threadId: 'thread' }, applied())
    await vi.waitFor(() => expect(sent.some((frame) => frame.payload?.live?.delta)).toBe(true), { timeout: 2000 })
    expect(reads()).toBe(2)
    await service.subscribe('phone', { kind: 'code', id: 'thread', active: false })
    writer.close()
    await watching
    // Once the subscription ends there is nothing left to refresh.
    expect(service.touch('phone', 'code', 'thread')).toBe(false)
  })
})

describe('desktop receipt path', () => {
  function fixture(receipt: unknown) {
    let socket!: Socket
    const frames: any[] = []
    const request = vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify(receipt) }))
    const deps: LinkDependencies = { origin: 'https://relay.test', name: 'Host', platform: 'macos',
      account: { getState: async () => ({ status: 'authenticated', error: null,
        user: { id: 'owner', name: 'Owner', email: 'owner@test.invalid', avatarUrl: null } }),
      onState: () => () => {}, accessToken: async () => 'token', expire: async () => {} },
      identity: async () => ({ id: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) }),
      lease: async () => ({ runtimeToken: 'runtime', request }),
      fetch: async (input) => { const path = new URL(String(input)).pathname
        return Response.json(path.endsWith('/grants') ? { grants: [{ id: grant, controllerId: phone }] } : path.endsWith('/relay-tickets') ?
          { url: 'wss://relay.test/ws', ticket: 'ticket' } : { ok: true }) },
      socket: () => (socket = { onopen: null, onmessage: null, onerror: null, onclose: null,
        close: () => socket.onclose?.(), send: (raw) => frames.push(JSON.parse(raw)) }) }
    const service = new MobileLinkService(deps)
    const invoke = (method: string, params: unknown, id: string) => socket.onmessage?.({ data: JSON.stringify({ v: 1,
      kind: 'invoke', src: phone, id, payload: { method, params, requestId: id, expiresAt: Date.now() + 60000 } }) })
    return { service, frames, invoke, hello: () => socket.onmessage?.({ data: '{"v":1,"kind":"hello"}' }) }
  }
  it('refreshes the phone page after its applied send has been answered', async () => {
    const f = fixture(applied({ threadId: 'task', turnId: 'turn', userMessageItemId: 'item' }))
    const order: string[] = []
    // The relay client paces socket writes; what matters is that the answer was handed over first.
    const send = RemoteClient.prototype.send
    vi.spyOn(RemoteClient.prototype, 'send').mockImplementation(function (this: RemoteClient, frame) {
      if (frame.kind === 'result') order.push('result')
      return send.call(this, frame)
    })
    const touch = vi.spyOn(MobileSubscriptions.prototype, 'touch').mockImplementation(() => { order.push('touch'); return true })
    try {
      await f.service.enable(true); await tick(); f.hello()
      f.invoke('code.turn.start', { threadId: 'task', text: 'hi', attachmentIds: [] }, 'send')
      await vi.waitFor(() => expect(touch).toHaveBeenCalledWith(phone, 'code', 'task'))
      expect(order).toEqual(['result', 'touch'])
    } finally { f.service.dispose(); await tick() }
  })
  it('leaves the page alone when the write was not applied', async () => {
    const f = fixture({ receipt: { status: 'reconciliation_required' } })
    const touch = vi.spyOn(MobileSubscriptions.prototype, 'touch')
    try {
      await f.service.enable(true); await tick(); f.hello()
      f.invoke('code.turn.start', { threadId: 'task', text: 'hi', attachmentIds: [] }, 'send')
      await vi.waitFor(() => expect(f.frames.some((frame) => frame.kind === 'result')).toBe(true))
      expect(touch).not.toHaveBeenCalled()
    } finally { f.service.dispose(); await tick() }
  })
})
