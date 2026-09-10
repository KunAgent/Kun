import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestManagerJson, requestManagerResponse } from './manager-client-support.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { callManagerStore, isManagerStoreRead } from './remote-data-store-request.js'
import { ServiceManagerHttpError, ServiceManagerTransportError } from './usage-errors.js'

const manager = { discovery: { baseUrl: 'http://127.0.0.1:19001', managerToken: 'test-token' } } as ServiceManagerConnection
const broken = (code = 'UND_ERR_SOCKET') => new TypeError('fetch failed', { cause: Object.assign(new Error('socket closed'), { code }) })
afterEach(() => vi.unstubAllGlobals())

describe('Manager transport recovery', () => {
  it('retries a dropped read on the same authenticated endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(broken()).mockResolvedValueOnce(Response.json({ ok: true }))
    expect(await requestManagerJson(manager, '/v1/documents/settings', { fetch: fetchImpl })).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(Array(2).fill('http://127.0.0.1:19001/v1/documents/settings'))
    expect(fetchImpl.mock.calls[1]?.[1]?.signal).toBe(fetchImpl.mock.calls[0]?.[1]?.signal)
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer test-token' })
  })

  it('retries a read whose response body was interrupted', async () => {
    const body = new ReadableStream({ start(controller) { controller.error(broken()) } })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(Response.json({ found: true }))
    expect(await requestManagerJson(manager, '/read', { fetch: fetchImpl })).toEqual({ found: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('recovers POST-based timeline reads but never replays ambiguous event writes', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(broken()).mockResolvedValueOnce(Response.json({ result: [] }))
    vi.stubGlobal('fetch', fetchImpl)
    expect(await callManagerStore(manager, 'session', 'loadItems', { threadId: 'child' })).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    fetchImpl.mockReset().mockRejectedValue(broken())
    await expect(callManagerStore(manager, 'session', 'appendEvent', { event: {} })).rejects.toBeInstanceOf(ServiceManagerTransportError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(isManagerStoreRead('session', 'allocateEventSeq')).toBe(false)
    expect(isManagerStoreRead('session', 'trimEventsFromSeq')).toBe(false)
    expect(isManagerStoreRead('thread', 'deleteByWorkspace')).toBe(false)
    expect(isManagerStoreRead('thread', 'futureOperation')).toBe(false)
  })

  it('retries refused connections before a mutation could have reached the server', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(broken('ECONNREFUSED')).mockResolvedValueOnce(Response.json({ ok: true }))
    await requestManagerResponse(manager, '/write', { method: 'POST', body: { value: 1 }, fetch: fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map(([, init]) => init?.body)).toEqual(['{"value":1}', '{"value":1}'])
  })

  it('stops after three attempts and reports the local service and socket cause', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(broken('ECONNRESET'))
    await expect(requestManagerJson(manager, '/read', { fetch: fetchImpl })).rejects.toMatchObject({
      name: 'ServiceManagerTransportError', kind: 'socket_closed', message: expect.stringContaining('ECONNRESET')
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not retry authorization errors or invalid JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('no', { status: 401 }))
    await expect(requestManagerJson(manager, '/read', { fetch: fetchImpl })).rejects.toBeInstanceOf(ServiceManagerHttpError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockReset().mockResolvedValue(new Response('invalid JSON'))
    await expect(requestManagerJson(manager, '/read', { fetch: fetchImpl })).rejects.toBeInstanceOf(SyntaxError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('cancels during retry backoff without sending another request', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      queueMicrotask(() => controller.abort())
      throw broken()
    })
    await expect(requestManagerJson(manager, '/read', { fetch: fetchImpl, signal: controller.signal })).rejects.toBeDefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps the original timeout budget across retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(broken())
    await expect(requestManagerJson(manager, '/read', { fetch: fetchImpl, timeoutMs: 10 })).rejects.toBeDefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
