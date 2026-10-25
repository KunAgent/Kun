import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteApi } from '@kun/remote-protocol'
import { MobileNotifications } from './notifications'
afterEach(() => vi.useRealTimers())
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
function fixture(available = true) {
  let writer!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn(), request = vi.fn(async (path: string) => path === '/capabilities' ? { notifications: { available } } : { queued: 1 })
  const api = { request } as unknown as RemoteApi
  const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { writer = controller }, cancel })))
  const bridge = new MobileNotifications({ fetch: fetcher, lease: async () => ({ baseUrl: 'http://runtime', runtimeToken: 'runtime', request: vi.fn() }) })
  const emit = (value: unknown) => writer.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n'))
  return { bridge, api, request, fetcher, cancel, emit }
}
describe('desktop notification bridge', () => {
  it('opens no runtime stream when old/missing/off server capability disables notifications', async () => {
    const f = fixture(false)
    try {
      f.bridge.start(f.api, () => true); f.bridge.start(f.api, () => true)
      await tick(); expect(f.request).toHaveBeenCalledOnce(); expect(f.fetcher).not.toHaveBeenCalled()
    } finally { f.bridge.stop() }
  })
  it('rechecks capability after a failed request or until the server enables notifications', async () => {
    vi.useFakeTimers()
    const f = fixture(false)
    f.request.mockImplementationOnce(async () => { throw new Error('offline') })
    try {
      f.bridge.start(f.api, () => true); await vi.advanceTimersByTimeAsync(0)
      expect(f.request).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(5000); expect(f.request).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(599000); expect(f.request).toHaveBeenCalledTimes(2)
      expect(f.fetcher).not.toHaveBeenCalled()
      f.request.mockImplementation(async (path: string) => path === '/capabilities' ? { notifications: { available: true } } : { queued: 1 })
      await vi.advanceTimersByTimeAsync(1000); expect(f.request).toHaveBeenCalledTimes(3)
      expect(f.fetcher).toHaveBeenCalledOnce()
    } finally { f.bridge.stop(); await vi.advanceTimersByTimeAsync(0) }
  })
  it('stops rechecking capability once the session is no longer eligible', async () => {
    vi.useFakeTimers()
    const f = fixture(false)
    try {
      f.bridge.start(f.api, () => true); await vi.advanceTimersByTimeAsync(0)
      f.bridge.stop(); await vi.advanceTimersByTimeAsync(3600000)
      expect(f.request).toHaveBeenCalledOnce(); expect(f.fetcher).not.toHaveBeenCalled()
    } finally { f.bridge.stop() }
  })
  it('has one subscription, sends only four opaque metadata fields, and deduplicates repeated intents', async () => {
    const f = fixture(), event = { eventId: 'event', resourceKind: 'code', resourceId: 'task', kind: 'completed' }
    try {
      f.bridge.start(f.api, () => true); f.bridge.start(f.api, () => true)
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
      f.emit({ type: 'synchronized', cursor: 'one' }); f.emit({ cursor: 'two', event }); f.emit({ cursor: 'two', event })
      await vi.waitFor(() => expect(f.request.mock.calls.filter(([path]) => path === '/notifications/events')).toHaveLength(1))
      expect(f.request).toHaveBeenCalledWith('/notifications/events', 'POST', event, false, expect.any(AbortSignal))
      f.bridge.stop(); await tick(); expect(f.cancel).toHaveBeenCalledOnce()
    } finally { f.bridge.stop() }
  })
  it('rejects accidental titles/body and fences a late capability result after account/stop changes', async () => {
    const f = fixture()
    try {
      f.bridge.start(f.api, () => true); await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
      f.emit({ cursor: 'bad', event: { eventId: 'e', resourceKind: 'agent', resourceId: 'a', kind: 'approval', title: 'private' } })
      await tick(); expect(f.request.mock.calls.filter(([path]) => path === '/notifications/events')).toEqual([])
      f.bridge.stop()
      let resolve!: (value: any) => void
      f.request.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      f.bridge.start(f.api, () => true); await tick(); f.bridge.stop()
      resolve({ notifications: { available: true } }); await tick()
      expect(f.fetcher).toHaveBeenCalledOnce()
    } finally { f.bridge.stop() }
  })
  it('retries the same opaque id at most three times and never creates an unlimited delivery loop', async () => {
    vi.useFakeTimers()
    const f = fixture(), event = { eventId: 'same', resourceKind: 'code', resourceId: 'task', kind: 'failed' }
    f.request.mockImplementation(async (path) => {
      if (path === '/capabilities') return { notifications: { available: true } }
      throw new Error('lost response')
    })
    try {
      f.bridge.start(f.api, () => true); await vi.advanceTimersByTimeAsync(0)
      f.emit({ cursor: 'next', event }); await vi.advanceTimersByTimeAsync(4001)
      expect(f.request.mock.calls.filter(([path]) => path === '/notifications/events')).toHaveLength(3)
      f.emit({ cursor: 'next', event }); await vi.advanceTimersByTimeAsync(5000)
      expect(f.request.mock.calls.filter(([path]) => path === '/notifications/events')).toHaveLength(3)
    } finally { f.bridge.stop(); await vi.advanceTimersByTimeAsync(0) }
  })
  it('bounds a fetch that ignores abort and cancels its late response body after stop', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let resolve!: (response: Response) => void
    f.fetcher.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    try {
      f.bridge.start(f.api, () => true); await vi.advanceTimersByTimeAsync(15001)
      f.bridge.stop()
      const cancel = vi.fn()
      resolve(new Response(new ReadableStream({ cancel })))
      await vi.advanceTimersByTimeAsync(0)
      expect(cancel).toHaveBeenCalledOnce()
      expect(f.request.mock.calls.filter(([path]) => path === '/notifications/events')).toEqual([])
    } finally { f.bridge.stop() }
  })

})
