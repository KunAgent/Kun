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
import { RemoteClientSender } from './remote/remote-sender'
import type { IpcMain } from 'electron'

describe('runtime-sse-ipc remote overflow', () => {
  let handlers: Map<string, (event: any, args: any) => Promise<any>>
  let mockIpcMain: IpcMain
  let mockStore: any
  let mockEnsureRuntime: any
  let mockLogError: any
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
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stops only the overflowed stream when the remote hub drops its backlog', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const sender = new RemoteClientSender('client-1', () => undefined)
    const event = { sender }
    const signals: AbortSignal[] = []
    mockFetch.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      signals.push(signal)
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })

    const first = await handlers.get('runtime:sse:start')!(event, {
      threadId: 'thread-a', sinceSeq: 0
    })
    const second = await handlers.get('runtime:sse:start')!(event, {
      threadId: 'thread-b', sinceSeq: 0
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(signals).toHaveLength(2)

    sender.emit('remote:streams-overflowed', [first.streamId])
    await vi.advanceTimersByTimeAsync(0)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    sender.emit('remote:streams-overflowed', [second.streamId])
    await vi.advanceTimersByTimeAsync(0)
    expect(signals[1].aborted).toBe(true)
    sender.destroy()
  })

  it('does not leave an ACK timer that later emits a stray terminal after an in-send overflow', async () => {
    registerRuntimeSseIpc({
      ipcMain: mockIpcMain,
      store: mockStore,
      ensureRuntime: mockEnsureRuntime,
      assertRendererRuntimeReady: () => undefined,
      logError: mockLogError
    })
    const sent: Array<{ channel: string; payload: any }> = []
    let sender: RemoteClientSender
    sender = new RemoteClientSender('client-1', (channel, payload) => {
      sent.push({ channel, payload: payload as any })
      // The hub overflows this stream while the batch is being sent.
      if (channel === 'runtime:sse-event') {
        sender.emit('remote:streams-overflowed', [(payload as { streamId: string }).streamId])
      }
    })
    const encoder = new TextEncoder()
    mockFetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('id: 1\ndata: {"seq":1,"kind":"heartbeat"}\n\n'))
      }
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))

    await handlers.get('runtime:sse:start')!({ sender }, {
      threadId: 'thread-a', sinceSeq: 0, acknowledgedBatches: true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.some((frame) => frame.channel === 'runtime:sse-event')).toBe(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(sent.some((frame) =>
      frame.channel === 'runtime:sse-error' && frame.payload?.code === 'renderer_ack_timeout'
    )).toBe(false)
    sender.destroy()
  })
})
