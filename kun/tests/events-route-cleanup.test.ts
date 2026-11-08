import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { ManagerRemoteSessionStore } from '../src/manager/remote-data-stores.js'
import { startNodeHttpServer } from '../src/server/node-http-server.js'
import { Router } from '../src/server/router.js'
import { buildEventStreamResponse } from '../src/server/routes/events.js'
import { ThreadEventStreamRegistry } from '../src/server/thread-event-stream-registry.js'

function fixture() {
  const threadId = 'thr_stream_cleanup'
  const sessionStore = new ManagerRemoteSessionStore(null as never)
  const highestSeq = vi.spyOn(sessionStore, 'highestSeq').mockResolvedValue(0)
  vi.spyOn(sessionStore, 'eventReplayFloorSeq').mockResolvedValue(0)
  vi.spyOn(sessionStore, 'iterateEventsSince').mockImplementation(async function* () {})
  const watch = vi.spyOn(sessionStore, 'watchEventsSince')
  const eventBus = new InMemoryEventBus()
  const streamRegistry = new ThreadEventStreamRegistry()
  const unregister = vi.fn()
  const register = streamRegistry.register.bind(streamRegistry)
  vi.spyOn(streamRegistry, 'register').mockImplementation((id, close) => {
    const remove = register(id, close)
    return () => { unregister(); remove() }
  })
  const unsubscribe = vi.fn()
  const subscribe = eventBus.subscribe.bind(eventBus)
  vi.spyOn(eventBus, 'subscribe').mockImplementation((id, handler) => {
    const remove = subscribe(id, handler)
    return () => { unsubscribe(); remove() }
  })
  return { threadId, sessionStore, highestSeq, watch, eventBus, streamRegistry, unregister, unsubscribe }
}

describe('event stream watcher cleanup', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['closeThread', 'cancel', 'abort'] as const)(
    'stops idle Manager polling after %s over localhost HTTP', async (termination) => {
      const f = fixture()
      const router = new Router()
      let requestSignal: AbortSignal | undefined
      router.add('GET', '/events', (request) => {
        requestSignal = request.signal
        return buildEventStreamResponse({ ...f, request })
      })
      const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
      const clientAbort = new AbortController()
      try {
        const response = await fetch(`http://${server.host}:${server.port}/events`, {
          signal: clientAbort.signal
        })
        const reader = response.body!.getReader()
        const first = await reader.read()
        expect(new TextDecoder().decode(first.value)).toContain('event: replay_synchronized')
        await vi.waitFor(() => expect(f.watch).toHaveBeenCalledTimes(1))
        const watcherSignal = f.watch.mock.calls[0]![2]
        expect(watcherSignal).not.toBe(requestSignal)
        expect(watcherSignal.aborted).toBe(false)
        const initialQueries = f.highestSeq.mock.calls.length
        await delay(300)
        expect(f.highestSeq.mock.calls.length).toBeGreaterThan(initialQueries)

        if (termination === 'closeThread') {
          f.streamRegistry.closeThread(f.threadId)
          // Server EOF does not require aborting the incoming Fetch request.
          expect(requestSignal!.aborted).toBe(false)
          await expect(reader.read()).resolves.toMatchObject({ done: true })
        } else if (termination === 'cancel') {
          await reader.cancel()
        } else {
          clientAbort.abort()
          await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
        }
        await vi.waitFor(() => expect(watcherSignal.aborted).toBe(true))
        expect(f.unsubscribe).toHaveBeenCalledTimes(1)
        expect(f.unregister).toHaveBeenCalledTimes(1)
        const queriesAfterClose = f.highestSeq.mock.calls.length
        await delay(600)
        expect(f.highestSeq).toHaveBeenCalledTimes(queriesAfterClose)
        if (termination === 'closeThread') expect(requestSignal!.aborted).toBe(false)
      } finally {
        clientAbort.abort()
        f.streamRegistry.closeAll()
        await server.close()
      }
    }
  )

  it('cancels a response body without aborting its request and releases all timers', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const request = new Request('http://localhost/events')
    const response = buildEventStreamResponse({ ...f, request })
    const reader = response.body!.getReader()
    try {
      await reader.read()
      await vi.advanceTimersByTimeAsync(0)
      const watcherSignal = f.watch.mock.calls[0]![2]
      await reader.cancel()
      expect(request.signal.aborted).toBe(false)
      expect(watcherSignal.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
      const queriesAfterCancel = f.highestSeq.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000)
      expect(f.highestSeq).toHaveBeenCalledTimes(queriesAfterCancel)
      f.streamRegistry.closeAll()
      expect(f.unsubscribe).toHaveBeenCalledTimes(1)
      expect(f.unregister).toHaveBeenCalledTimes(1)
    } finally {
      f.streamRegistry.closeAll()
    }
  })

  it('cancels only its own watcher when two streams share a request signal', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const abort = new AbortController()
    const request = new Request('http://localhost/events', { signal: abort.signal })
    const first = buildEventStreamResponse({ ...f, request }).body!.getReader()
    const second = buildEventStreamResponse({ ...f, request }).body!.getReader()
    try {
      await Promise.all([first.read(), second.read()])
      await vi.advanceTimersByTimeAsync(0)
      const firstSignal = f.watch.mock.calls[0]![2]
      const secondSignal = f.watch.mock.calls[1]![2]
      expect(firstSignal).not.toBe(secondSignal)
      await first.cancel()
      expect(firstSignal.aborted).toBe(true)
      expect(secondSignal.aborted).toBe(false)
      const queriesAfterCancel = f.highestSeq.mock.calls.length
      await vi.advanceTimersByTimeAsync(250)
      expect(f.highestSeq).toHaveBeenCalledTimes(queriesAfterCancel + 1)
      abort.abort()
      await expect(second.read()).resolves.toMatchObject({ done: true })
      expect(secondSignal.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      abort.abort()
      f.streamRegistry.closeAll()
    }
  })

  it('does not subscribe or start a watcher for an already aborted request', async () => {
    const f = fixture()
    const abort = new AbortController()
    abort.abort()
    const response = buildEventStreamResponse({
      ...f, request: new Request('http://localhost/events', { signal: abort.signal })
    })
    await expect(response.body!.getReader().read()).resolves.toMatchObject({ done: true })
    expect(f.eventBus.subscribe).not.toHaveBeenCalled()
    expect(f.highestSeq).not.toHaveBeenCalled()
    expect(f.watch).not.toHaveBeenCalled()
  })

  it('releases the watcher, registry and heartbeat even if unsubscribe throws', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.unsubscribe.mockImplementation(() => { throw new Error('unsubscribe failed') })
    const response = buildEventStreamResponse({ ...f, request: new Request('http://localhost/events') })
    const reader = response.body!.getReader()
    try {
      await reader.read()
      await vi.advanceTimersByTimeAsync(0)
      f.streamRegistry.closeThread(f.threadId)
      await expect(reader.read()).resolves.toMatchObject({ done: true })
      expect(f.watch.mock.calls[0]![2].aborted).toBe(true)
      expect(f.unregister).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      f.streamRegistry.closeAll()
    }
  })

  it('aborts the watcher and releases resources when watching rejects', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.watch.mockImplementation(async function* () { yield await Promise.reject(new Error('watch failed')) })
    const response = buildEventStreamResponse({ ...f, request: new Request('http://localhost/events') })
    const reader = response.body!.getReader()
    try {
      await reader.read()
      await vi.advanceTimersByTimeAsync(0)
      await expect(reader.read()).resolves.toMatchObject({ done: true })
      expect(f.watch.mock.calls[0]![2].aborted).toBe(true)
      expect(f.unsubscribe).toHaveBeenCalledTimes(1)
      expect(f.unregister).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      f.streamRegistry.closeAll()
    }
  })
})
