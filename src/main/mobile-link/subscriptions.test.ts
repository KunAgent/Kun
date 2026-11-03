import { describe, expect, it, vi } from 'vitest'
import { MobileSubscriptions } from './subscriptions'
import { EVENT_FRAME_SPACING_MS } from './event-coalescer'

const input = { kind: 'code', id: 'thread-one', since: 4 }
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(response: Promise<Response> | Response) {
  const send = vi.fn(), fetcher = vi.fn(async () => response) as typeof fetch
  const service = new MobileSubscriptions({
    lease: async () => ({ baseUrl: 'http://runtime.test', runtimeToken: 'runtime', request: vi.fn() }),
    fetch: fetcher, send
  })
  return { service, send, fetcher }
}

describe('mobile runtime subscription recovery', () => {
  it('requests resynchronization after a normal EOF and permits another subscription', async () => {
    const f = fixture(new Response('data: {"seq":5}\n\n'))
    await f.service.subscribe('phone', input)
    expect(f.send.mock.calls.map(([frame]) => frame.kind)).toEqual(['event', 'event', 'resync_required'])
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({
      dst: 'phone', payload: { resource: 'code', resourceId: 'thread-one' }
    }))
    vi.mocked(f.fetcher).mockResolvedValueOnce(new Response('data: {"seq":6}\n\n'))
    await f.service.subscribe('phone', { ...input, since: 5 })
    expect(f.fetcher).toHaveBeenLastCalledWith(
      'http://runtime.test/v1/remote/events/code/thread-one?since=5', expect.any(Object)
    )
    expect(f.send.mock.calls.some(([frame]) => frame.payload?.event?.seq === 6)).toBe(true)
  })
  it('requests recovery when the runtime is unavailable', async () => {
    const f = fixture(new Response(null, { status: 503 }))
    await f.service.subscribe('phone', input)
    expect(f.send).toHaveBeenCalledOnce()
    expect(f.send.mock.calls[0][0].kind).toBe('resync_required')
  })
  it('does not request resync or forward late events after the connection is fenced', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>
    const f = fixture(new Response(new ReadableStream<Uint8Array>({ start(controller) { writer = controller } })))
    const watching = f.service.subscribe('phone', input)
    await tick()
    f.service.clear()
    writer.enqueue(new TextEncoder().encode('data: {"seq":5}\n\n'))
    await watching
    expect(f.send.mock.calls.map(([frame]) => frame.payload?.kind)).toEqual(['subscribed'])
  })
  it('ignores a successful fetch that returns after unsubscription', async () => {
    let resolve!: (response: Response) => void
    const f = fixture(new Promise<Response>((done) => { resolve = done }))
    const watching = f.service.subscribe('phone', input)
    await tick()
    await f.service.subscribe('phone', { ...input, active: false })
    resolve(new Response('data: {"seq":5}\n\n'))
    await watching
    expect(f.send).not.toHaveBeenCalled()
  })
  it('never opens a group stream without trusted scope and forwards trusted scope headers only', async () => {
    const f = fixture(new Response('data: {"seq":5}\n\n'))
    const group = { kind: 'group', id: 'group', since: 0 }
    await expect(f.service.subscribe('phone', group)).rejects.toThrow('REMOTE_SCOPE_REQUIRED')
    expect(f.fetcher).not.toHaveBeenCalled()
    await f.service.subscribe('phone', group, { accountId: 'owner', deviceId: 'phone', authorizationId: 'authority', scopes: ['personal', 'groups.read'] })
    expect(f.fetcher).toHaveBeenCalledWith('http://runtime.test/v1/remote/events/group/group?since=0', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Kun-Remote-Scopes': 'personal,groups.read', 'X-Kun-Remote-Account': 'owner' }) }))
  })
  it('requires recovery for oversized events instead of forwarding an unbounded frame', async () => {
    const f = fixture(new Response('data: ' + 'x'.repeat(4 * 1024 * 1024)))
    await f.service.subscribe('phone', input)
    expect(f.send.mock.calls.map(([frame]) => frame.kind)).toEqual(['event', 'resync_required'])
  })
  it('relays a burst of deltas as one frame per spacing carrying the newest cursor', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      let writer!: ReadableStreamDefaultController<Uint8Array>
      const f = fixture(new Response(new ReadableStream<Uint8Array>({ start(controller) { writer = controller } })))
      const watching = f.service.subscribe('phone', input)
      const deltas = (from: number, to: number) => writer.enqueue(new TextEncoder().encode(
        Array.from({ length: to - from + 1 }, (_, i) => `id: ${from + i}\nevent: item.delta\ndata: {"kind":"item.delta","seq":${from + i}}\n\n`).join('')))
      await tick()
      deltas(5, 54)
      await tick()
      const relayed = () => f.send.mock.calls.filter(([frame]) => frame.payload?.event).map(([frame]) => frame.payload.event.seq)
      expect(relayed()).toEqual([5])
      await vi.advanceTimersByTimeAsync(EVENT_FRAME_SPACING_MS)
      expect(relayed()).toEqual([5, 54])
      deltas(55, 60)
      await tick()
      writer.close()
      await watching
      // The held cursor reaches the phone before the resync notice that follows a stream end.
      expect(relayed()).toEqual([5, 54, 60])
      expect(f.send.mock.calls.at(-1)![0].kind).toBe('resync_required')
    } finally { vi.useRealTimers() }
  })
  it('drops a held event when the subscription is fenced before the next frame is due', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      let writer!: ReadableStreamDefaultController<Uint8Array>
      const f = fixture(new Response(new ReadableStream<Uint8Array>({ start(controller) { writer = controller } })))
      const watching = f.service.subscribe('phone', input)
      await tick()
      writer.enqueue(new TextEncoder().encode('data: {"kind":"item.delta","seq":5}\n\ndata: {"kind":"item.delta","seq":6}\n\n'))
      await tick()
      f.service.clear('phone')
      await vi.advanceTimersByTimeAsync(EVENT_FRAME_SPACING_MS * 2)
      writer.enqueue(new TextEncoder().encode('data: {"kind":"item.delta","seq":7}\n\n'))
      await watching
      expect(f.send.mock.calls.map(([frame]) => frame.payload?.event?.seq ?? frame.payload?.kind)).toEqual(['subscribed', 5])
    } finally { vi.useRealTimers() }
  })
})
