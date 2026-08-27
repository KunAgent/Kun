import { describe, expect, it, vi } from 'vitest'
import type { ServiceManagerConnection } from './manager-client.js'
import { requestManagerResponse } from './manager-client-support.js'

const manager = {
  discovery: {
    baseUrl: 'http://127.0.0.1:19001',
    managerToken: 'manager-token'
  }
} as ServiceManagerConnection

describe('requestManagerResponse signal handling', () => {
  it('combines an external signal with the manager timeout', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      let observed: AbortSignal | undefined
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        observed = init?.signal ?? undefined
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch

      await requestManagerResponse(manager, '/v1/leases/threads/thr_1', {
        fetch: fetchImpl,
        signal: controller.signal,
        timeoutMs: 5_000
      })

      expect(observed).toBeDefined()
      expect(observed?.aborted).toBe(false)
      controller.abort()
      expect(observed?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates a bounded timeout signal for manager requests', async () => {
    let observed: AbortSignal | undefined
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      observed = init?.signal ?? undefined
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await requestManagerResponse(manager, '/v1/leases/threads/thr_1', {
      fetch: fetchImpl,
      timeoutMs: 10
    })

    expect(observed).toBeDefined()
    expect(observed?.aborted).toBe(false)
  })
})
