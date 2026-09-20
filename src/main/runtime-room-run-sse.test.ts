import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/kun-test' } }))
vi.mock('./runtime/kun-adapter', () => ({
  getRuntimeBaseUrlForSettings: () => 'http://localhost:18899',
  runtimeAuthHeaders: () => new Map([['authorization', 'Bearer test-token']])
}))
import { registerRuntimeSseIpc } from './runtime-sse-ipc'
import { runtimeRequestPayloadSchema } from './ipc/app-ipc-schemas/runtime'
import { sseStartPayloadSchema } from './ipc/app-ipc-schemas/system'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('room run bridge scope', () => {
  it('permits only read routes and requires the server-resolved run scope for streaming', () => {
    for (const path of ['/v1/rooms/r/runs', '/v1/rooms/r/runs/run-a',
      '/v1/rooms/r/runs/run-a/items?item_id=tool', '/v1/rooms/r/runs/run-a/events', '/v1/rooms/r/messages/m/run']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'GET' }).success).toBe(true)
      expect(runtimeRequestPayloadSchema.safeParse({ path, method: 'POST' }).success).toBe(false)
    }
    const valid = { threadId: 'run-a', sinceSeq: 0, scope: 'room-run', roomId: 'r', runId: 'run-a', cursor: 'opaque_cursor' }
    expect(sseStartPayloadSchema.safeParse(valid).success).toBe(true)
    expect(sseStartPayloadSchema.safeParse({ ...valid, roomId: undefined }).success).toBe(false)
    expect(sseStartPayloadSchema.safeParse({ ...valid, scope: 'rooms' }).success).toBe(false)
    expect(sseStartPayloadSchema.safeParse({ ...valid, runId: '../thread' }).success).toBe(false)
  })
  it('reconnects selected-run SSE from its opaque cursor and releases on close', async () => {
    vi.useFakeTimers()
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
    const owner = { isDestroyed: () => false, send: vi.fn(), once: vi.fn() }
    const settings = { agents: { kun: {} } }
    registerRuntimeSseIpc({
      ipcMain: { handle: (name: string, handle: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handle) } as unknown as IpcMain,
      store: { load: async () => settings } as never,
      ensureRuntime: async () => undefined, assertRendererRuntimeReady: () => undefined, logError: vi.fn()
    })
    let secondSignal: AbortSignal | undefined
    const fetchMock = vi.fn().mockImplementation(async (_url: URL, init: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        let delivered = false
        return { ok: true, status: 200, body: { getReader: () => ({ read: async () => {
          if (delivered) throw new Error('network interrupted')
          delivered = true
          return { done: false, value: new TextEncoder().encode(
            'id: cursor_after\nevent: run.items_changed\ndata: {"kind":"run.items_changed","roomId":"r","runId":"run-a","cursor":"cursor_after"}\n\n') }
        } }) } }
      }
      secondSignal = init.signal as AbortSignal
      return new Promise((_resolve, reject) => secondSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await handlers.get('runtime:sse:start')!({ sender: owner }, {
      threadId: 'run-a', sinceSeq: 0, streamId: 'run-inspector-test', scope: 'room-run',
      roomId: 'r', runId: 'run-a', cursor: 'cursor_before'
    })
    expect(result).toEqual({ streamId: 'run-inspector-test' })
    await vi.advanceTimersByTimeAsync(800)
    const firstUrl = fetchMock.mock.calls[0][0] as URL
    const secondUrl = fetchMock.mock.calls[1][0] as URL
    expect(firstUrl.pathname).toBe('/v1/rooms/r/runs/run-a/events')
    expect(firstUrl.searchParams.get('cursor')).toBe('cursor_before')
    expect(secondUrl.searchParams.get('cursor')).toBe('cursor_after')
    expect(secondUrl.searchParams.has('since_seq')).toBe(false)
    expect(owner.send).toHaveBeenCalledWith('runtime:sse-event', expect.objectContaining({
      streamId: 'run-inspector-test', events: [expect.objectContaining({ runId: 'run-a', cursor: 'cursor_after' })]
    }))
    await handlers.get('runtime:sse:stop')!({ sender: owner }, 'run-inspector-test')
    expect(secondSignal?.aborted).toBe(true)
  })
})
