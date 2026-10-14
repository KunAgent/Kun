import { describe, expect, it, vi } from 'vitest'
import { MobileSubscriptions } from './subscriptions'

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
  it('requires recovery for oversized events instead of forwarding an unbounded frame', async () => {
    const f = fixture(new Response('data: ' + 'x'.repeat(4 * 1024 * 1024)))
    await f.service.subscribe('phone', input)
    expect(f.send.mock.calls.map(([frame]) => frame.kind)).toEqual(['event', 'resync_required'])
  })
})
