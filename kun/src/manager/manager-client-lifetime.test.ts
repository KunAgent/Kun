import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeManagerClientAdmission, managerClientRequestSignal, openManagerClientAdmission } from './manager-client-lifetime.js'
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
})
