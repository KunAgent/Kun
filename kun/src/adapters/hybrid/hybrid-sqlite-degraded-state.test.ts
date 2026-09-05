import { afterEach, describe, expect, it, vi } from 'vitest'
import { HybridSqliteDegradedState } from './hybrid-sqlite-degraded-state.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('HybridSqliteDegradedState', () => {
  it('warns once until recovery while retrying through bounded cooldowns', () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const state = new HybridSqliteDegradedState()
    const failure = new Error('source.indexCount is not a function')

    state.fail('listPage', failure)
    state.fail('listPage', failure)

    expect(state.available(true)).toBe(false)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('entering 30s degraded cooldown'))
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('npm rebuild better-sqlite3'))

    vi.advanceTimersByTime(30_000)
    expect(state.available(true)).toBe(true)
    state.fail('listPage', failure)
    expect(warning).toHaveBeenCalledTimes(1)

    state.recover()
    expect(warning).toHaveBeenCalledTimes(2)
    state.fail('listPage', failure)
    expect(warning).toHaveBeenCalledTimes(3)
  })
})
