import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { watchAgentSetupLogin } from './agent-setup-refresh'

afterEach(() => vi.useRealTimers())
describe('Agent login terminal refresh', () => {
  it('detects login without requiring shell exit and stops when logged in', async () => {
    vi.useFakeTimers()
    const probe = vi.fn().mockResolvedValueOnce({ status: { login: 'signed-out' } }).mockResolvedValue({ status: { login: 'signed-in' } })
    const refresh = vi.fn(async () => undefined)
    const stop = watchAgentSetupLogin({ probe, refresh })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(probe).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(2); stop()
  })
  it('does not overlap slow probes or refresh after cleanup', async () => {
    vi.useFakeTimers()
    let finish!: (row: AdeHarnessRow) => void
    const probe = vi.fn(() => new Promise<AdeHarnessRow>((resolve) => { finish = resolve }))
    const refresh = vi.fn(async () => undefined)
    const stop = watchAgentSetupLogin({ probe, refresh })
    await vi.advanceTimersByTimeAsync(30_000); expect(probe).toHaveBeenCalledTimes(1)
    stop(); finish({ status: { login: 'signed-in' } } as AdeHarnessRow)
    await vi.advanceTimersByTimeAsync(30_000); expect(refresh).not.toHaveBeenCalled()
  })
  it('bounds retries after failure', async () => {
    vi.useFakeTimers()
    const probe = vi.fn().mockRejectedValue(new Error('offline'))
    const stop = watchAgentSetupLogin({ probe, refresh: async () => undefined, timeoutMs: 15_000 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(probe).toHaveBeenCalledTimes(2); stop()
  })
})
