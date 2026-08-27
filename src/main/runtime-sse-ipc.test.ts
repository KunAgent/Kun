import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/kun-test' } }))
vi.mock('./runtime/kun-adapter', () => ({
  getRuntimeBaseUrlForSettings: (settings: {
    agents: { kun: { baseUrl?: string; port?: number } }
  }) => settings.agents.kun.baseUrl ?? `http://127.0.0.1:${settings.agents.kun.port}`,
  runtimeAuthHeaders: (settings: { agents: { kun: { runtimeToken: string } } }) =>
    new Map([['authorization', `Bearer ${settings.agents.kun.runtimeToken}`]])
}))

import { registerRuntimeSseIpc } from './runtime-sse-ipc'
import type { IpcMain } from 'electron'

describe('runtime-sse-ipc', () => {
  let handlers: Map<string, (event: any, args: any) => Promise<any>>
  let mockIpcMain: IpcMain
  let mockStore: any
  let mockEnsureRuntime: any
  let mockLogError: any
  let mockEvent: any
  let mockFetch: any

  beforeEach(() => {
    vi.useFakeTimers()
    handlers = new Map()
    mockIpcMain = {
      handle: (channel: string, handler: any) => {
        handlers.set(channel, handler)
      }
    } as unknown as IpcMain

    mockStore = {
      load: vi.fn().mockResolvedValue({
        agents: {
          kun: {
            baseUrl: 'http://localhost:18899',
            runtimeToken: 'test-token'
          }
        }
      })
    }

    mockEnsureRuntime = vi.fn().mockImplementation(async (settings) => settings)
    mockLogError = vi.fn()

    mockEvent = {
      sender: {
        isDestroyed: () => false,
        send: vi.fn()
      }
    }

    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function mockReadableStream(chunks: string[]) {
    const enc = new TextEncoder()
    let chunkIndex = 0
    return {
      getReader() {
        return {
          read: async () => {
            if (chunkIndex >= chunks.length) {
              return { done: true, value: undefined }
            }
            const chunk = chunks[chunkIndex++]
            if (chunk === '__ERROR__') {
              throw new Error('Network Disruption')
            }
            if (chunk === '__TERMINATED__') {
              throw new Error('terminated')
            }
            return { done: false, value: enc.encode(chunk) }
          }
        }
      }
    }
  }

  it('flushes pending events and updates nextSinceSeq correctly on disconnect and reconnects from last seq', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })

    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()

    // First fetch: emits two events, then experiences network disconnect
    const stream1 = mockReadableStream([
      'id: 1\ndata: {"text": "hello"}\n\n',
      'id: 2\ndata: {"text": "world"}\n\n',
      '__ERROR__'
    ])

    // Second fetch: receives the remaining event, then ends normally
    const stream2 = mockReadableStream([
      'id: 3\ndata: {"text": "bye"}\n\n'
    ])

    let secondFetchUrl: string | null = null

    mockFetch.mockImplementation(async (url: any) => {
      const urlStr = url.toString()
      const callCount = mockFetch.mock.calls.length
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          body: stream1
        }
      } else if (callCount === 2) {
        secondFetchUrl = urlStr
        return {
          ok: true,
          status: 200,
          body: stream2
        }
      } else {
        // Return a fatal error on the third call to cleanly terminate the reconnect loop
        return {
          ok: false,
          status: 400
        }
      }
    })

    // Start SSE listener, sinceSeq starts at 0
    const startRes = await startHandler!(mockEvent, {
      threadId: 'thread-123',
      sinceSeq: 0
    })
    const streamId = startRes.streamId

    // Advance time to start reading the first stream
    await vi.advanceTimersByTimeAsync(0)

    // Advance time to trigger finally block, flush events, and trigger reconnection sleep (750ms)
    await vi.advanceTimersByTimeAsync(750)

    // Verify all 3 fetch attempts took place (Initial, Reconnect after error, Reconnect after stream end)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    
    // The second fetch (after disconnect) should reconnect with seq=2
    expect(secondFetchUrl).toContain('since_seq=2')
    
    // The third fetch (after stream 2 ends normally) should reconnect with seq=3
    const thirdFetchUrl = mockFetch.mock.calls[2][0].toString()
    expect(thirdFetchUrl).toContain('since_seq=3')

    // Stop connection cleanly
    const stopHandler = handlers.get('runtime:sse:stop')
    expect(stopHandler).toBeDefined()
    await stopHandler!(mockEvent, streamId)

    // Check emitted events
    const sendCalls = mockEvent.sender.send.mock.calls
    const eventMessages = sendCalls
      .filter((call: any) => call[0] === 'runtime:sse-event')
      .map((call: any) => call[1])

    expect(eventMessages.length).toBeGreaterThan(0)
    
    // Verify all events are present in order
    const allEvents = eventMessages.flatMap((msg: any) => msg.events)
    expect(allEvents).toHaveLength(3)
    expect(allEvents[0].seq).toBe(1)
    expect(allEvents[0].text).toBe('hello')
    expect(allEvents[1].seq).toBe(2)
    expect(allEvents[1].text).toBe('world')
    expect(allEvents[2].seq).toBe(3)
    expect(allEvents[2].text).toBe('bye')
  })

  it('uses the replay synchronization cursor when reconnecting after an id-less marker', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()
    mockFetch.mockImplementation(async () => {
      if (mockFetch.mock.calls.length === 1) {
        return {
          ok: true,
          status: 200,
          body: mockReadableStream([
            'event: replay_synchronized\ndata: {"kind":"replay_synchronized","threadId":"thread-sync","cursor":42}\n\n',
            '__ERROR__'
          ])
        }
      }
      return { ok: false, status: 400, body: null }
    })

    const started = await startHandler!(mockEvent, {
      threadId: 'thread-sync',
      sinceSeq: 7
    })
    await vi.advanceTimersByTimeAsync(750)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][0].toString()).toContain('since_seq=42')
    const marker = mockEvent.sender.send.mock.calls
      .find((call: any) => call[0] === 'runtime:sse-event')?.[1]?.events?.[0]
    expect(marker).toMatchObject({
      kind: 'replay_synchronized',
      threadId: 'thread-sync',
      cursor: 42
    })
    await handlers.get('runtime:sse:stop')!(mockEvent, started.streamId)
  })

  it('retries a bounded number of times on 404 before surfacing the error', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()

    // 1 initial attempt + first 2 retries 404; the 3rd retry reaches a
    // stream that ends cleanly (one event) so the loop stops without an
    // endless immediate-reconnect spin against the mock reader.
    let fetchCalls = 0
    mockFetch.mockImplementation(async () => {
      fetchCalls += 1
      if (fetchCalls <= 3) return { ok: false, status: 404, body: null }
      return { ok: false, status: 400, body: null }
    })

    const started = await startHandler!(mockEvent, {
      threadId: 'thread-404-race',
      sinceSeq: 0
    })

    // Retries use 750ms → 1.5s → 3s backoff; one large advance covers all
    // pending sleeps plus the terminal 400 that follows.
    await vi.advanceTimersByTimeAsync(6_000)

    expect(mockFetch).toHaveBeenCalledTimes(4)
    // The 404s retried instead of terminating on the first response.
    expect(mockLogError).toHaveBeenCalledWith(
      'sse',
      expect.stringContaining('SSE 404 for thread thread-404-race; retry 1/3'),
      expect.objectContaining({ streamId: started.streamId })
    )
  })

  it('reports a terminal error after exhausting 404 retries', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()

    mockFetch.mockImplementation(async () => ({ ok: false, status: 404, body: null }))

    const started = await startHandler!(mockEvent, {
      threadId: 'thread-404-final',
      sinceSeq: 0
    })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(mockEvent.sender.send).toHaveBeenCalledWith(
      'runtime:sse-error',
      expect.objectContaining({ streamId: started.streamId, status: 404, threadMissing: true })
    )
    expect(mockLogError).toHaveBeenCalledWith(
      'sse',
      expect.stringContaining('SSE 404'),
      expect.objectContaining({ streamId: started.streamId })
    )
  })

  it('treats terminated stream reads as reconnectable SSE disconnects', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })

    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()

    const stream1 = mockReadableStream([
      'id: 7\ndata: {"text": "partial"}\n\n',
      '__TERMINATED__'
    ])
    const stream2 = mockReadableStream([
      'id: 8\ndata: {"text": "final"}\n\n'
    ])

    mockFetch.mockImplementation(async () => {
      const callCount = mockFetch.mock.calls.length
      if (callCount === 1) {
        return { ok: true, status: 200, body: stream1 }
      }
      if (callCount === 2) {
        return { ok: true, status: 200, body: stream2 }
      }
      return { ok: false, status: 400 }
    })

    const startRes = await startHandler!(mockEvent, {
      threadId: 'thread-terminated',
      sinceSeq: 0
    })

    await vi.advanceTimersByTimeAsync(750)

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[1][0].toString()).toContain('since_seq=7')
    expect(mockEvent.sender.send).not.toHaveBeenCalledWith(
      'runtime:sse-error',
      expect.objectContaining({ streamId: startRes.streamId, message: 'terminated' })
    )
    expect(mockLogError).not.toHaveBeenCalledWith(
      'sse',
      expect.stringContaining('SSE stream error'),
      expect.objectContaining({ message: 'terminated' })
    )

    const stopHandler = handlers.get('runtime:sse:stop')
    expect(stopHandler).toBeDefined()
    await stopHandler!(mockEvent, startRes.streamId)

    const allEvents = mockEvent.sender.send.mock.calls
      .filter((call: any) => call[0] === 'runtime:sse-event')
      .flatMap((call: any) => call[1].events)
    expect(allEvents.map((event: any) => event.seq)).toEqual([7, 8])
  })

  it('re-resolves the shared runtime URL and token before reconnecting', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()

    const first = {
      agents: { kun: { port: 18899, runtimeToken: 'first-token' } }
    }
    const second = {
      agents: { kun: { port: 18900, runtimeToken: 'second-token' } }
    }
    mockStore.load
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValue(second)
    mockEnsureRuntime.mockImplementation(async (settings: unknown) => settings)
    mockFetch.mockImplementation(async () => {
      if (mockFetch.mock.calls.length === 1) {
        return {
          ok: true,
          status: 200,
          body: mockReadableStream([
            'id: 4\ndata: {"text": "before restart"}\n\n',
            '__ERROR__'
          ])
        }
      }
      return { ok: false, status: 400, body: null }
    })

    const started = await startHandler!(mockEvent, {
      threadId: 'thread-runtime-restart',
      sinceSeq: 0
    })
    await vi.advanceTimersByTimeAsync(750)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0].toString()).toContain('127.0.0.1:18899')
    expect(mockFetch.mock.calls[1][0].toString()).toContain('127.0.0.1:18900')
    expect(new Headers(mockFetch.mock.calls[0][1].headers).get('authorization'))
      .toBe('Bearer first-token')
    expect(new Headers(mockFetch.mock.calls[1][1].headers).get('authorization'))
      .toBe('Bearer second-token')
    expect(mockFetch.mock.calls[1][0].toString()).toContain('since_seq=4')

    await handlers.get('runtime:sse:stop')!(mockEvent, started.streamId)
  })

  it('does not advance the reconnect cursor until the renderer acknowledges a batch', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    const ackHandler = handlers.get('runtime:sse:ack')
    expect(startHandler).toBeDefined()
    expect(ackHandler).toBeDefined()

    mockFetch.mockImplementation(async () => {
      if (mockFetch.mock.calls.length === 1) {
        return {
          ok: true,
          status: 200,
          body: mockReadableStream(['id: 9\ndata: {"text": "await-ack"}\n\n'])
        }
      }
      return { ok: false, status: 400, body: null }
    })

    const started = await startHandler!(mockEvent, {
      threadId: 'thread-ack',
      sinceSeq: 0,
      acknowledgedBatches: true
    })
    await vi.advanceTimersByTimeAsync(0)

    const batch = mockEvent.sender.send.mock.calls.find((call: any) => call[0] === 'runtime:sse-event')?.[1]
    expect(batch).toMatchObject({ streamId: started.streamId, events: [{ seq: 9 }] })
    expect(typeof batch.batchId).toBe('string')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await expect(ackHandler!(mockEvent, {
      streamId: started.streamId,
      batchId: batch.batchId
    })).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][0].toString()).toContain('since_seq=9')
  })

  it('surfaces an id-less server replay error instead of reconnecting into the same cursor', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: mockReadableStream(['event: error\ndata: {"message": "oversized replay record"}\n\n'])
    })

    const started = await startHandler!(mockEvent, { threadId: 'thread-server-error', sinceSeq: 0 })
    await vi.advanceTimersByTimeAsync(0)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockEvent.sender.send).toHaveBeenCalledWith(
      'runtime:sse-error',
      expect.objectContaining({ streamId: started.streamId, message: 'oversized replay record' })
    )
  })

  it('rejects SSE attach while the desktop startup gate is not ready', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => {
        throw new Error('Kun desktop startup is not ready (phase: runtime_starting).')
      },
      logError: mockLogError
    })

    await expect(handlers.get('runtime:sse:start')!(mockEvent, {
      threadId: 'thread-startup-gated',
      sinceSeq: 0
    })).rejects.toThrow(/startup is not ready/)
    expect(mockStore.load).not.toHaveBeenCalled()
    expect(mockEnsureRuntime).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
