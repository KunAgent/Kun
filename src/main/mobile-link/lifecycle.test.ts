import { afterEach, describe, expect, it, vi } from 'vitest'
import { disableHost, sessionOperation } from './lifecycle'

afterEach(() => vi.useRealTimers())
const identity = { id: 'host', credential: 'credential' }
describe('bounded remote session cleanup', () => {
  it('finishes within five seconds even if a transport ignores its abort signal', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch
    const cleanup = disableHost({ origin: 'https://relay.test', fetch: fetcher, identity, token: 'old-token' })
    await vi.advanceTimersByTimeAsync(5000)
    await expect(cleanup).resolves.toBe(false)
    expect(vi.mocked(fetcher).mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('confirms successful revocation and treats a rejected token as failed cleanup', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true })) as typeof fetch
    await expect(disableHost({ origin: 'https://relay.test', fetch: fetcher, identity, token: 'old-token' })).resolves.toBe(true)
    vi.mocked(fetcher).mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(disableHost({ origin: 'https://relay.test', fetch: fetcher, identity, token: 'old-token' })).resolves.toBe(false)
  })
  it('bounds an unresponsive startup operation and supports immediate cancellation', async () => {
    vi.useFakeTimers()
    const control = new AbortController()
    const work = sessionOperation(() => new Promise<void>(() => {}), control.signal)
    const rejected = expect(work).rejects.toThrow('CONNECTION_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    const cancelled = sessionOperation(() => new Promise<void>(() => {}), control.signal)
    const aborted = expect(cancelled).rejects.toThrow('ACCOUNT_CHANGED')
    control.abort()
    await aborted
  })
})
