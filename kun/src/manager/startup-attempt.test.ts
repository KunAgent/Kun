import { afterEach, describe, expect, it, vi } from 'vitest'
import { StartupAttempt } from './startup-attempt.js'

afterEach(() => vi.restoreAllMocks())
describe('shared startup budget', () => {
  it('uses monotonic elapsed time and reserves cleanup across phases', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(100)
    const events = vi.fn()
    const attempt = new StartupAttempt(1_000, undefined, events)
    try {
      clock.mockReturnValue(750)
      attempt.note('manager-ready')
      attempt.check()
      expect(attempt.workDeadline).toBe(1000)
      expect(attempt.cleanupMs()).toBe(350)
      clock.mockReturnValue(1001)
      expect(() => attempt.check()).toThrow('startup timed out during manager-ready')
      expect(attempt.signal.aborted).toBe(true)
      expect(attempt.cleanupMs()).toBe(99)
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ elapsedMs: 650, stage: 'manager-ready' }))
    } finally { attempt.dispose() }
  })
  it('preserves cancellation and never admits a later stage', () => {
    const cancel = new AbortController()
    const attempt = new StartupAttempt(1000, cancel.signal)
    try {
      cancel.abort(new Error('window closed'))
      expect(() => attempt.check()).toThrow('window closed')
    } finally { attempt.dispose() }
  })
})
