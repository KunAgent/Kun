import type { TurnLimitsConfig } from '../loop/turn-limits.js'

const ORDINARY_CHILD_MAX_STEPS = 128
const ORDINARY_CHILD_MAX_WALL_MS = 60 * 60_000
const ORDINARY_CHILD_MAX_TOOL_CALLS_PER_STEP = 64
const FAST_CONTEXT_MAX_STEPS = 4
const FAST_CONTEXT_MAX_WALL_MS = 10 * 60_000
const FAST_CONTEXT_MAX_TOOL_CALLS_PER_STEP = 8

/** Inherit stricter user limits while preserving a finite child episode. */
export function resolveChildEpisodeLimits(
  configured: TurnLimitsConfig | undefined,
  fastContext: boolean
): TurnLimitsConfig {
  const ceilings = fastContext
    ? {
        maxSteps: FAST_CONTEXT_MAX_STEPS,
        maxWallTimeMs: FAST_CONTEXT_MAX_WALL_MS,
        maxToolCallsPerStep: FAST_CONTEXT_MAX_TOOL_CALLS_PER_STEP
      }
    : {
        maxSteps: ORDINARY_CHILD_MAX_STEPS,
        maxWallTimeMs: ORDINARY_CHILD_MAX_WALL_MS,
        maxToolCallsPerStep: ORDINARY_CHILD_MAX_TOOL_CALLS_PER_STEP
      }
  return {
    maxSteps: Math.min(configured?.maxSteps ?? ceilings.maxSteps, ceilings.maxSteps),
    maxWallTimeMs: Math.min(
      configured?.maxWallTimeMs ?? ceilings.maxWallTimeMs,
      ceilings.maxWallTimeMs
    ),
    maxToolCallsPerStep: Math.min(
      configured?.maxToolCallsPerStep ?? ceilings.maxToolCallsPerStep,
      ceilings.maxToolCallsPerStep
    )
  }
}
