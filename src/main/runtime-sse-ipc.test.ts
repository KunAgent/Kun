import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('treats terminated stream reads as reconnectable SSE disconnects', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
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

  it('emits a structured seq_conflict error when the wire regresses within one connection', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()

    // Same connection: a data event with seq 1 after a delivered seq 2 can
    // never be legal replay — replay is strictly ascending.
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: mockReadableStream([
        'id: 1\ndata: {"text": "a"}\n\n',
        'id: 2\ndata: {"text": "b"}\n\n',
        'id: 1\ndata: {"text": "regressed"}\n\n'
      ])
    })

    const started = await startHandler!(mockEvent, { threadId: 'thr_conflict', sinceSeq: 0 })
    await vi.advanceTimersByTimeAsync(0)

    // The transport stops immediately — no blind reconnect from the dead cursor.
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockEvent.sender.send).toHaveBeenCalledWith(
      'runtime:sse-error',
      expect.objectContaining({ streamId: started.streamId, code: 'seq_conflict' })
    )
    expect(mockLogError).toHaveBeenCalledWith(
      'sse',
      expect.stringContaining('sequence conflict'),
      expect.objectContaining({ regressedFrom: 2, observed: 1, streamId: started.streamId })
    )
    // The legal prefix was delivered exactly once; the regressed frame never is.
    const deliveredSeqs = mockEvent.sender.send.mock.calls
      .filter((call: any) => call[0] === 'runtime:sse-event')
      .flatMap((call: any) => call[1].events)
      .map((event: any) => event.seq)
    expect(deliveredSeqs).toEqual([1, 2])
  })

  it('catches cross-connection seq reuse on the first frame of a reconnected stream', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      logError: mockLogError
    })
    const startHandler = handlers.get('runtime:sse:start')
    expect(startHandler).toBeDefined()

    const first = mockReadableStream([
      'id: 5\ndata: {"text": "durable"}\n\n',
      '__TERMINATED__'
    ])
    // A truncated persisted tail makes the runtime reissue an already
    // consumed seq below the cursor the reconnect requested.
    const second = mockReadableStream([
      'id: 3\ndata: {"text": "reused"}\n\n'
    ])
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, body: first })
      .mockResolvedValueOnce({ ok: true, status: 200, body: second })
      .mockResolvedValue({ ok: false, status: 400 })

    const started = await startHandler!(mockEvent, { threadId: 'thr_reuse', sinceSeq: 0 })
    await vi.advanceTimersByTimeAsync(0)
    // 'terminated' is transient: reconnect after the initial 750ms backoff.
    await vi.advanceTimersByTimeAsync(750)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][0].toString()).toContain('since_seq=5')
    expect(mockEvent.sender.send).toHaveBeenCalledWith(
      'runtime:sse-error',
      expect.objectContaining({ streamId: started.streamId, code: 'seq_conflict' })
    )
    expect(mockLogError).toHaveBeenCalledWith(
      'sse',
      expect.stringContaining('sequence conflict'),
      expect.objectContaining({ regressedFrom: 5, observed: 3 })
    )
    // No further reconnect: replaying from the same cursor would freeze the projection.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
