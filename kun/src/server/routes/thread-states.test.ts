import { describe, expect, it, vi, afterEach } from 'vitest'
import { ZodError } from 'zod'
import { getThreadStates } from './threads.js'
import { THREAD_RUNTIME_STATE_OWNER_TIMEOUT_MS } from './register-thread-routes.js'
import { ThreadStateLoadError } from './thread-state-error.js'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'
import type { JsonResponse } from '../response.js'

function runtimeState(id: string) {
  return {
    schemaVersion: 1 as const,
    id,
    status: 'running' as const,
    updatedAt: '2026-08-22T00:00:00.000Z',
    latestSeq: 1,
    pendingUserInputIds: id === 'thr_7' ? ['in_7'] : [],
    latestTurn: null
  }
}

describe('getThreadStates', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('deduplicates ids, bounds concurrency at four, and preserves request order', async () => {
    let active = 0
    let maxActive = 0
    const loadState = vi.fn(async (id: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return runtimeState(id)
    })
    const threadIds = Array.from({ length: 20 }, (_, index) => `thr_${index}`)
    const response = await getThreadStates(new Request('http://kun.local/v1/threads/states', {
      method: 'POST',
      body: JSON.stringify({ threadIds: [...threadIds, 'thr_7'] })
    }), loadState)
    const body = JSON.parse(response.body)

    expect(maxActive).toBe(4)
    expect(loadState).toHaveBeenCalledTimes(20)
    expect(body.results.map((result: { id: string }) => result.id)).toEqual(threadIds)
    expect(body.results[7].state.pendingUserInputIds).toEqual(['in_7'])
  })

  it('keeps missing and unavailable failures scoped to their thread', async () => {
    const response = await getThreadStates(new Request('http://kun.local/v1/threads/states', {
      method: 'POST',
      body: JSON.stringify({ threadIds: ['thr_ok', 'thr_missing', 'thr_error'] })
    }), async (id) => {
      if (id === 'thr_missing') return null
      if (id === 'thr_error') throw new Error('owner offline')
      return runtimeState(id)
    })

    expect(JSON.parse(response.body).results).toEqual([
      { id: 'thr_ok', ok: true, state: runtimeState('thr_ok') },
      {
        id: 'thr_missing', ok: false,
        error: { code: 'not_found', message: 'thread not found: thr_missing' }
      },
      {
        id: 'thr_error', ok: false,
        error: { code: 'unavailable', message: 'thread state unavailable: thr_error' }
      }
    ])
  })

  it('maps owner errors to fine-grained codes and logs structured diagnostics', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await getThreadStates(new Request('http://kun.local/v1/threads/states', {
      method: 'POST',
      body: JSON.stringify({ threadIds: ['thr_owner_500', 'thr_owner_down'] })
    }), async (id) => {
      if (id === 'thr_owner_500') {
        throw new ThreadStateLoadError('owner_error', 'owner_response', { httpStatus: 500 })
      }
      throw new ThreadStateLoadError('owner_unreachable', 'owner_forward', {
        cause: new Error('socket hang up')
      })
    })

    expect(JSON.parse(response.body).results).toEqual([
      {
        id: 'thr_owner_500', ok: false,
        error: { code: 'owner_error', message: 'thread state unavailable: thr_owner_500' }
      },
      {
        id: 'thr_owner_down', ok: false,
        error: { code: 'owner_unreachable', message: 'thread state unavailable: thr_owner_down' }
      }
    ])
    const logged = warn.mock.calls.map((call) => JSON.parse(String(call[0]).replace(/^\[kun\] thread state batch load failed: /, '')))
    expect(logged).toHaveLength(2)
    expect(logged[0]).toMatchObject({
      threadId: 'thr_owner_500',
      stage: 'owner_response',
      httpStatus: 500,
      errorName: 'ThreadStateLoadError',
      code: 'owner_error'
    })
    expect(typeof logged[0].durationMs).toBe('number')
    expect(logged[1]).toMatchObject({
      threadId: 'thr_owner_down',
      stage: 'owner_forward',
      code: 'owner_unreachable'
    })
  })

  it('maps schema failures to schema_incompatible', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await getThreadStates(new Request('http://kun.local/v1/threads/states', {
      method: 'POST',
      body: JSON.stringify({ threadIds: ['thr_bad_schema'] })
    }), async () => {
      throw new ZodError([])
    })

    expect(JSON.parse(response.body).results).toEqual([
      {
        id: 'thr_bad_schema', ok: false,
        error: { code: 'schema_incompatible', message: 'thread state unavailable: thr_bad_schema' }
      }
    ])
  })

  it('maps storage failures to storage_error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await getThreadStates(new Request('http://kun.local/v1/threads/states', {
      method: 'POST',
      body: JSON.stringify({ threadIds: ['thr_disk'] })
    }), async () => {
      throw new ThreadStateLoadError('storage_error', 'metadata', { cause: new Error('EIO') })
    })

    expect(JSON.parse(response.body).results).toEqual([
      {
        id: 'thr_disk', ok: false,
        error: { code: 'storage_error', message: 'thread state unavailable: thr_disk' }
      }
    ])
  })

  it('rejects more than 200 requested ids before loading any state', async () => {
    const loadState = vi.fn(async (id: string) => runtimeState(id))
    const response = await getThreadStates(new Request('http://kun.local/v1/threads/states', {
      method: 'POST',
      body: JSON.stringify({
        threadIds: Array.from({ length: 201 }, (_, index) => `thr_${index}`)
      })
    }), loadState)

    expect(response.status).toBe(400)
    expect(loadState).not.toHaveBeenCalled()
  })

  it('forwards each batch state read to its execution owner', async () => {
    const forwardThreadControl = vi.fn(async (_request: Request, threadId: string) =>
      new Response(JSON.stringify({
        ...runtimeState(threadId),
        latestSeq: 3,
        pendingUserInputIds: threadId === 'thr_waiting' ? ['in_waiting'] : []
      }), { status: 200 }))
    const router = buildRouter({
      runtimeToken: 'thread-route-token', insecure: false, forwardThreadControl
    } as unknown as ServerRuntime)
    const request = new Request('http://127.0.0.1/v1/threads/states', {
      method: 'POST',
      headers: {
        authorization: 'Bearer thread-route-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ threadIds: ['thr_running', 'thr_waiting'] })
    })
    const match = router.match('POST', new URL(request.url).pathname)
    if (!match) throw new Error('thread states route not found')

    const result = await match.handler(request, { params: match.params }) as JsonResponse
    expect(JSON.parse(result.body).results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thr_running', ok: true }),
      expect.objectContaining({
        id: 'thr_waiting',
        state: expect.objectContaining({ pendingUserInputIds: ['in_waiting'] })
      })
    ]))
    expect(forwardThreadControl).toHaveBeenCalledTimes(2)
    expect(forwardThreadControl.mock.calls.map((call) => call[1])).toEqual([
      'thr_running', 'thr_waiting'
    ])
    expect(forwardThreadControl.mock.calls[0][0]).toMatchObject({ method: 'GET' })
    expect(forwardThreadControl.mock.calls[0][0].headers.get('content-type')).toBeNull()
  })

  it('accepts a legacy owner state without pending user input ids', async () => {
    const legacyState = {
      id: 'thr_legacy',
      status: 'running',
      updatedAt: '2026-08-22T00:00:00.000Z',
      latestSeq: 8,
      latestTurn: null
    }
    const forwardThreadControl = vi.fn(async () =>
      new Response(JSON.stringify(legacyState), { status: 200 }))
    const router = buildRouter({
      runtimeToken: 'thread-route-token', insecure: false, forwardThreadControl
    } as unknown as ServerRuntime)
    const request = new Request('http://127.0.0.1/v1/threads/states', {
      method: 'POST',
      headers: {
        authorization: 'Bearer thread-route-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ threadIds: ['thr_legacy'] })
    })
    const match = router.match('POST', new URL(request.url).pathname)
    if (!match) throw new Error('thread states route not found')

    const result = await match.handler(request, { params: match.params }) as JsonResponse
    expect(JSON.parse(result.body).results).toEqual([{
      id: 'thr_legacy',
      ok: true,
      state: { ...legacyState, schemaVersion: 1, pendingUserInputIds: [] }
    }])
  })

  it('times out one unreachable owner while returning the other 19 states', async () => {
    vi.useFakeTimers()
    const threadIds = Array.from({ length: 20 }, (_, index) => `thr_${index}`)
    const forwardThreadControl = vi.fn((request: Request, threadId: string) => {
      if (threadId === 'thr_0') {
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
        })
      }
      return Promise.resolve(new Response(JSON.stringify(runtimeState(threadId)), { status: 200 }))
    })
    const router = buildRouter({
      runtimeToken: 'thread-route-token', insecure: false, forwardThreadControl
    } as unknown as ServerRuntime)
    const request = new Request('http://127.0.0.1/v1/threads/states', {
      method: 'POST',
      headers: {
        authorization: 'Bearer thread-route-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ threadIds })
    })
    const match = router.match('POST', new URL(request.url).pathname)
    if (!match) throw new Error('thread states route not found')

    let settled = false
    const responsePromise = Promise.resolve(match.handler(request, { params: match.params })).then((value) => {
      settled = true
      return value as JsonResponse
    })
    await vi.advanceTimersByTimeAsync(THREAD_RUNTIME_STATE_OWNER_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await responsePromise

    const body = JSON.parse(result.body)
    expect(body.results.map((entry: { id: string }) => entry.id)).toEqual(threadIds)
    expect(body.results[0]).toMatchObject({
      id: 'thr_0', ok: false, error: { code: 'owner_unreachable' }
    })
    expect(body.results.slice(1).every((entry: { ok: boolean }) => entry.ok)).toBe(true)
  })

  it('aborts forwarded owner state requests when the batch request is cancelled', async () => {
    const controller = new AbortController()
    const seenSignals: AbortSignal[] = []
    const forwardThreadControl = vi.fn((request: Request) => {
      seenSignals.push(request.signal)
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
      })
    })
    const router = buildRouter({
      runtimeToken: 'thread-route-token', insecure: false, forwardThreadControl
    } as unknown as ServerRuntime)
    const request = new Request('http://127.0.0.1/v1/threads/states', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: 'Bearer thread-route-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ threadIds: ['thr_cancel'] })
    })
    const match = router.match('POST', new URL(request.url).pathname)
    if (!match) throw new Error('thread states route not found')

    const responsePromise = match.handler(request, { params: match.params })
    await vi.waitFor(() => expect(seenSignals).toHaveLength(1))
    controller.abort()
    const result = await responsePromise as JsonResponse

    expect(seenSignals[0]?.aborted).toBe(true)
    expect(JSON.parse(result.body).results).toEqual([expect.objectContaining({
      id: 'thr_cancel', ok: false, error: expect.objectContaining({ code: 'owner_unreachable' })
    })])
  })

  it('marks a malformed owner state unavailable without affecting others', async () => {
    const forwardThreadControl = vi.fn(async (_request: Request, threadId: string) => {
      if (threadId === 'thr_bad') {
        return new Response(JSON.stringify({ id: 'thr_bad' }), { status: 200 })
      }
      return new Response(JSON.stringify(runtimeState(threadId)), { status: 200 })
    })
    const router = buildRouter({
      runtimeToken: 'thread-route-token', insecure: false, forwardThreadControl
    } as unknown as ServerRuntime)
    const request = new Request('http://127.0.0.1/v1/threads/states', {
      method: 'POST',
      headers: {
        authorization: 'Bearer thread-route-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ threadIds: ['thr_ok', 'thr_bad'] })
    })
    const match = router.match('POST', new URL(request.url).pathname)
    if (!match) throw new Error('thread states route not found')

    const result = await match.handler(request, { params: match.params }) as JsonResponse
    expect(JSON.parse(result.body).results).toEqual([
      { id: 'thr_ok', ok: true, state: runtimeState('thr_ok') },
      expect.objectContaining({
        id: 'thr_bad',
        ok: false,
        error: expect.objectContaining({ code: 'schema_incompatible' })
      })
    ])
  })
})
