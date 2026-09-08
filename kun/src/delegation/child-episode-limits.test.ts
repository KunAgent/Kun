import { describe, expect, it } from 'vitest'
import {
  resolveChildEpisodeLimits,
  shouldUseFastContextEpisodeBudget
} from './child-episode-limits.js'

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

describe('shouldUseFastContextEpisodeBudget', () => {
  it('is true for the dedicated fast_context entry point', () => {
    expect(shouldUseFastContextEpisodeBudget({ fastContext: true })).toBe(true)
  })

  it('is true when a generic delegate_task resolves to the explore profile', () => {
    expect(shouldUseFastContextEpisodeBudget({ profile: 'explore' })).toBe(true)
    expect(shouldUseFastContextEpisodeBudget({ fastContext: false, profile: 'explore' })).toBe(true)
  })

  it('is false for ordinary profiles and default empty inputs', () => {
    expect(shouldUseFastContextEpisodeBudget({ profile: 'general' })).toBe(false)
    expect(shouldUseFastContextEpisodeBudget({})).toBe(false)
    expect(shouldUseFastContextEpisodeBudget({ fastContext: false })).toBe(false)
  })
})
