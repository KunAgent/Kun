import { describe, expect, it } from 'vitest'
import {
  createCrashLoopState,
  DEFAULT_CRASH_LOOP_POLICY,
  reduceCrashLoop,
  type CrashLoopPolicy,
  type CrashLoopState
} from './crash-loop-breaker'

const policy: CrashLoopPolicy = {
  ...DEFAULT_CRASH_LOOP_POLICY,
  windowMs: 5 * 60 * 1_000,
  maxUnexpectedCrashes: 3,
  stableRuntimeMs: 2 * 60 * 1_000
}

function unexpected(state: CrashLoopState, at: number): CrashLoopState {
  return reduceCrashLoop(
    state,
    { type: 'runtime-exit', record: { at, classification: 'unexpected' } },
    policy
  )
}

describe('crash-loop breaker', () => {
  it('trips on the third unexpected exit in the five-minute window', () => {
    let state = createCrashLoopState()
    state = unexpected(state, 0)
    state = unexpected(state, 60_000)
    expect(state.tripped).toBe(false)

    state = unexpected(state, 120_000)
    expect(state.tripped).toBe(true)
    expect(state.unexpectedExits).toHaveLength(3)
  })

  it('does not count expected exits toward the threshold', () => {
    let state = createCrashLoopState()
    state = reduceCrashLoop(
      state,
      { type: 'runtime-exit', record: { at: 0, classification: 'expected' } },
      policy
    )
    state = reduceCrashLoop(
      state,
      { type: 'runtime-exit', record: { at: 60_000, classification: 'expected' } },
      policy
    )
    state = reduceCrashLoop(
      state,
      { type: 'runtime-exit', record: { at: 120_000, classification: 'expected' } },
      policy
    )

    expect(state.tripped).toBe(false)
    expect(state.unexpectedExits).toHaveLength(0)
    expect(state.lastExit?.classification).toBe('expected')
  })

  it('clears a tripped state after the runtime remains ready for two minutes', () => {
    let state = unexpected(createCrashLoopState(), 0)
    state = unexpected(state, 1_000)
    state = unexpected(state, 2_000)
    expect(state.tripped).toBe(true)

    state = reduceCrashLoop(state, { type: 'runtime-ready', at: 10_000 }, policy)
    state = reduceCrashLoop(state, { type: 'runtime-stable', at: 129_999 }, policy)
    expect(state.tripped).toBe(true)
    expect(state.unexpectedExits).toHaveLength(3)

    state = reduceCrashLoop(state, { type: 'runtime-stable', at: 130_000 }, policy)
    expect(state).toEqual(createCrashLoopState())
  })

  it('does not reset the stable window on repeated readiness probes', () => {
    let state = unexpected(createCrashLoopState(), 0)
    state = unexpected(state, 1_000)
    state = unexpected(state, 2_000)

    state = reduceCrashLoop(state, { type: 'runtime-ready', at: 10_000 }, policy)
    state = reduceCrashLoop(state, { type: 'runtime-ready', at: 60_000 }, policy)
    expect(state.stableSince).toBe(10_000)

    state = reduceCrashLoop(state, { type: 'runtime-stable', at: 130_000 }, policy)
    expect(state).toEqual(createCrashLoopState())
  })

  it('does not count exits outside the sliding window', () => {
    let state = unexpected(createCrashLoopState(), 0)
    state = unexpected(state, 60_000)
    state = unexpected(state, policy.windowMs + 1)

    expect(state.tripped).toBe(false)
    expect(state.unexpectedExits.map((record) => record.at)).toEqual([60_000, policy.windowMs + 1])
  })

  it('keeps reducer calls immutable and ignores stable before ready', () => {
    const initial = createCrashLoopState()
    const after = reduceCrashLoop(initial, { type: 'runtime-stable', at: 10_000 }, policy)

    expect(after).toEqual(initial)
    expect(after).not.toBe(initial)
  })

  it('does not clear history when the clock moves backwards', () => {
    let state = unexpected(createCrashLoopState(), 10_000)
    state = reduceCrashLoop(state, { type: 'runtime-ready', at: 20_000 }, policy)
    state = reduceCrashLoop(state, { type: 'runtime-stable', at: 19_999 }, policy)

    expect(state.unexpectedExits).toHaveLength(1)
    expect(state.stableSince).toBe(20_000)
  })

  it('normalizes invalid policy values to safe defaults', () => {
    let state = createCrashLoopState()
    const invalid = { windowMs: Number.NaN, maxUnexpectedCrashes: 0, stableRuntimeMs: -1 }
    state = reduceCrashLoop(
      state,
      { type: 'runtime-exit', record: { at: 0, classification: 'unexpected' } },
      invalid
    )
    state = reduceCrashLoop(
      state,
      { type: 'runtime-exit', record: { at: 1, classification: 'unexpected' } },
      invalid
    )
    state = reduceCrashLoop(
      state,
      { type: 'runtime-exit', record: { at: 2, classification: 'unexpected' } },
      invalid
    )

    expect(state.tripped).toBe(true)
  })
})
