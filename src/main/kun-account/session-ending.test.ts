import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifySessionEnding } from './session-ending'

afterEach(() => vi.useRealTimers())
describe('account-ending cleanup barrier', () => {
  it('fences synchronously and releases local logout after five seconds', async () => {
    vi.useFakeTimers()
    const listener = vi.fn(() => new Promise<void>(() => {}))
    const cleanup = notifySessionEnding(listener, { userId: 'old-owner', accessToken: 'old-token' })
    expect(listener).toHaveBeenCalledWith({ userId: 'old-owner', accessToken: 'old-token' })
    await vi.advanceTimersByTimeAsync(5000)
    await expect(cleanup).resolves.toBeUndefined()
  })
  it('does not let a throwing listener prevent local logout', async () => {
    await expect(notifySessionEnding(() => { throw new Error('offline') }, {
      userId: 'old-owner', accessToken: 'old-token'
    })).resolves.toBeUndefined()
  })
})
