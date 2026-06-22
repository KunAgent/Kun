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
})
