import { describe, expect, it } from 'vitest'
import {
  resolveChildEpisodeLimits,
  shouldUseFastContextEpisodeBudget
} from './child-episode-limits.js'

describe('resolveChildEpisodeLimits', () => {
  it('gives ordinary children finite episode ceilings', () => {
    expect(resolveChildEpisodeLimits(undefined, false)).toEqual({
      maxSteps: 2048,
      maxWallTimeMs: 60 * 60_000,
      maxToolCallsPerStep: 64
    })
  })

  it('inherits stricter runtime limits and clamps looser ones', () => {
    expect(resolveChildEpisodeLimits({
      maxSteps: 12, maxWallTimeMs: 30_000, maxToolCallsPerStep: 4
    }, false)).toEqual({ maxSteps: 12, maxWallTimeMs: 30_000, maxToolCallsPerStep: 4 })
    expect(resolveChildEpisodeLimits({
      maxSteps: 4096, maxWallTimeMs: 86_400_000, maxToolCallsPerStep: 10_000
    }, false)).toEqual({ maxSteps: 2048, maxWallTimeMs: 60 * 60_000, maxToolCallsPerStep: 64 })
  })

  it('allows configured budgets above the former 128-step ceiling', () => {
    expect(resolveChildEpisodeLimits({ maxSteps: 1024 }, false).maxSteps).toBe(1024)
    expect(resolveChildEpisodeLimits({ maxSteps: 2048 }, false).maxSteps).toBe(2048)
  })

  it('retains the tighter Fast Context episode', () => {
    expect(resolveChildEpisodeLimits({ maxSteps: 2048 }, true).maxSteps).toBe(4)
    expect(resolveChildEpisodeLimits(undefined, true)).toEqual({
      maxSteps: 4, maxWallTimeMs: 10 * 60_000, maxToolCallsPerStep: 8
    })
  })
})

describe('shouldUseFastContextEpisodeBudget', () => {
  it('is true for the dedicated fast_context entry point', () => {
    expect(shouldUseFastContextEpisodeBudget({ fastContext: true })).toBe(true)
  })

  it('leaves ordinary worker runs on the ordinary episode budget', () => {
    // Regression: the explore role forced the four-step Fast Context episode
    // onto every full worker run, so multi-file investigations died with
    // "turn exceeded 4 model steps" before returning any result.
    expect(shouldUseFastContextEpisodeBudget({ fastContext: false })).toBe(false)
    expect(shouldUseFastContextEpisodeBudget({})).toBe(false)
    expect(resolveChildEpisodeLimits({ maxSteps: 40 }, false).maxSteps).toBe(40)
  })
})
