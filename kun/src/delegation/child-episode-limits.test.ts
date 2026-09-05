import { describe, expect, it } from 'vitest'
import { resolveChildEpisodeLimits } from './child-episode-limits.js'

describe('resolveChildEpisodeLimits', () => {
  it('gives ordinary children finite episode ceilings', () => {
    expect(resolveChildEpisodeLimits(undefined, false)).toEqual({
      maxSteps: 128,
      maxWallTimeMs: 60 * 60_000,
      maxToolCallsPerStep: 64
    })
  })

  it('inherits stricter runtime limits and clamps looser ones', () => {
    expect(resolveChildEpisodeLimits({
      maxSteps: 12, maxWallTimeMs: 30_000, maxToolCallsPerStep: 4
    }, false)).toEqual({ maxSteps: 12, maxWallTimeMs: 30_000, maxToolCallsPerStep: 4 })
    expect(resolveChildEpisodeLimits({
      maxSteps: 999, maxWallTimeMs: 86_400_000, maxToolCallsPerStep: 10_000
    }, false)).toEqual({ maxSteps: 128, maxWallTimeMs: 60 * 60_000, maxToolCallsPerStep: 64 })
  })

  it('retains the tighter Fast Context episode', () => {
    expect(resolveChildEpisodeLimits(undefined, true)).toEqual({
      maxSteps: 4, maxWallTimeMs: 10 * 60_000, maxToolCallsPerStep: 8
    })
  })
})
