import { describe, expect, it, vi } from 'vitest'
import { GatewayRequestGuard, strictRuntimeTokenAuthorized } from './gateway-request-guard.js'

function request(token?: string): Request {
  return new Request('http://localhost/v1/models', token ? { headers: { authorization: `Bearer ${token}` } } : {})
}

describe('GatewayRequestGuard', () => {
  it('enforces an exact independent Bearer token matrix', () => {
    const guard = new GatewayRequestGuard({ verify: (candidate) => candidate === 'gateway-key' })
    expect(guard.authorize(request())).toBe(false)
    expect(guard.authorize(new Request('http://localhost', { headers: { authorization: 'Basic gateway-key' } }))).toBe(false)
    expect(guard.authorize(request('runtime-token'))).toBe(false)
    expect(guard.authorize(request('gateway-key'))).toBe(true)
  })

  it('requires the strict runtime token independently of insecure mode', () => {
    expect(strictRuntimeTokenAuthorized(request(), 'runtime-token')).toBe(false)
    expect(strictRuntimeTokenAuthorized(request('gateway-key'), 'runtime-token')).toBe(false)
    expect(strictRuntimeTokenAuthorized(request('runtime-token'), 'runtime-token')).toBe(true)
  })

  it('applies a refilling token bucket', () => {
    let now = 0
    const guard = new GatewayRequestGuard({ verify: () => true }, { capacity: 2, refillPerSecond: 1, now: () => now })
    expect(guard.consumeToken()).toBe(true)
    expect(guard.consumeToken()).toBe(true)
    expect(guard.consumeToken()).toBe(false)
    now = 1_000
    expect(guard.consumeToken()).toBe(true)
  })

  it('caps concurrency at two and releases idempotently', () => {
    const guard = new GatewayRequestGuard({ verify: () => true }, { timeoutMs: 10_000 })
    const first = guard.acquire(new AbortController().signal)!
    const second = guard.acquire(new AbortController().signal)!
    expect(guard.acquire(new AbortController().signal)).toBeNull()
    first.release()
    first.release()
    expect(guard.activeCount()).toBe(1)
    expect(guard.acquire(new AbortController().signal)).not.toBeNull()
    second.release()
  })

  it('aborts at the configured timeout and frees the lease', async () => {
    vi.useFakeTimers()
    try {
      const guard = new GatewayRequestGuard({ verify: () => true }, { timeoutMs: 120_000 })
      const lease = guard.acquire(new AbortController().signal)!
      await vi.advanceTimersByTimeAsync(120_000)
      expect(lease.signal.aborted).toBe(true)
      expect(lease.timedOut()).toBe(true)
      lease.release()
      expect(guard.activeCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('propagates client cancellation and releases the slot', () => {
    const guard = new GatewayRequestGuard({ verify: () => true })
    const parent = new AbortController()
    const lease = guard.acquire(parent.signal)!
    parent.abort()
    expect(lease.signal.aborted).toBe(true)
    lease.cancel()
    expect(guard.activeCount()).toBe(0)
  })
})
