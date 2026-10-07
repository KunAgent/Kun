import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeManagerClientAdmission, managerClientRequestSignal, openManagerClientAdmission, openManagerRequestSignal } from './manager-client-lifetime.js'
import { requestManagerJson } from './manager-client-support.js'
import type { ServiceManagerConnection } from './manager-client.js'

afterEach(() => openManagerClientAdmission())

describe('desktop Manager client lifetime', () => {
  it('cancels in-flight writes and rejects late writes before issuing a fetch', async () => {
    openManagerClientAdmission()
    const fetch = vi.fn((_url: unknown, init: RequestInit | undefined) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const manager = { discovery: { baseUrl: 'http://127.0.0.1:1234', managerToken: 'test-token' } } as ServiceManagerConnection
    const pending = requestManagerJson(manager, '/v1/documents/settings', { method: 'PUT', body: {}, fetch: fetch as typeof globalThis.fetch })
    const rejected = expect(pending).rejects.toThrow('data consumers have stopped')
    closeManagerClientAdmission()
    await rejected
    await expect(requestManagerJson(manager, '/v1/documents/settings', { method: 'PUT', fetch: fetch as typeof globalThis.fetch })).rejects.toThrow('data consumers have stopped')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('a new explicit session does not un-cancel old in-flight operations', () => {
    openManagerClientAdmission()
    const oldSignal = managerClientRequestSignal()
    closeManagerClientAdmission()
    openManagerClientAdmission()
    expect(oldSignal.aborted).toBe(true)
    expect(managerClientRequestSignal().aborted).toBe(false)
  })

  it('releases a disposable request signal without aborting it later', () => {
    vi.useFakeTimers()
    try {
      openManagerClientAdmission()
      const request = openManagerRequestSignal(undefined, 1_000)
      request.dispose()
      vi.advanceTimersByTime(5_000)
      expect(request.signal.aborted).toBe(false)
      closeManagerClientAdmission()
      expect(request.signal.aborted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts a disposable request signal on timeout, caller abort, or admission close', () => {
    vi.useFakeTimers()
    try {
      openManagerClientAdmission()
      const timed = openManagerRequestSignal(undefined, 1_000)
      vi.advanceTimersByTime(1_000)
      expect(timed.signal.reason).toMatchObject({ name: 'TimeoutError' })
      const caller = new AbortController()
      const cancelled = openManagerRequestSignal(caller.signal, 1_000)
      caller.abort(new Error('caller stopped'))
      expect(cancelled.signal.reason).toMatchObject({ message: 'caller stopped' })
      const live = openManagerRequestSignal(undefined, 1_000)
      closeManagerClientAdmission()
      expect(live.signal.reason).toMatchObject({ message: 'Application data consumers have stopped' })
      expect(() => openManagerRequestSignal(undefined, 1_000)).toThrow('data consumers have stopped')
    } finally {
      vi.useRealTimers()
    }
  })
})
