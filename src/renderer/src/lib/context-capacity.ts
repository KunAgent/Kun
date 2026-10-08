import type { RequestContextSnapshot } from '../agent/types'

export type ContextCategoryKey = 'tools' | 'system' | 'skills' | 'messages' | 'other'

export type ContextCategory = {
  key: ContextCategoryKey
  tokens: number
  /** Share of the whole context window, clamped to 0..1 for rendering. */
  ratio: number
}

export type ContextCapacity = {
  windowTokens: number
  totalWindowTokens: number
  maxInputTokens?: number
  usedTokens: number
  freeTokens: number
  usedRatio: number
  freeRatio: number
  softThresholdRatio: number
  hardThresholdRatio: number
  categories: ContextCategory[]
  /** Request-derived values use Kun's deterministic estimator, not a provider tokenizer. */
  estimated: true
  /** The SDK owns prior native history but does not report its occupancy. */
  nativeHistoryUnknown: boolean
  /** The Agent (not Kun) owns this context and compacts it itself. */
  agentManaged: boolean
  /** The Agent measured the total itself; there is no category breakdown. */
  agentReported: boolean
  /** Whether the soft threshold is a real compaction point for this context. */
  thresholdKnown: boolean
  /** Threshold that colors the gauge: the compaction point, else the window. */
  alertRatio: number
}

const CATEGORY_ORDER: readonly ContextCategoryKey[] = [
  'tools',
  'system',
  'skills',
  'messages',
  'other'
]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function nonnegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

/**
 * Build the UI model exclusively from one runtime request snapshot. Categories
 * are never scaled to provider usage or cumulative thread counters.
 */
export function buildContextCapacity(snapshot: RequestContextSnapshot): ContextCapacity {
  const totalWindowTokens = Math.max(1, nonnegativeInteger(snapshot.contextWindowTokens))
  const maxInputTokens = snapshot.maxInputTokens && snapshot.maxInputTokens > 0 ? nonnegativeInteger(snapshot.maxInputTokens) : undefined
  const windowTokens = Math.min(totalWindowTokens, maxInputTokens ?? totalWindowTokens)
  const categories = CATEGORY_ORDER.map((key) => {
    const tokens = nonnegativeInteger(snapshot.breakdown[key])
    return {
      key,
      tokens,
      ratio: clamp(tokens / windowTokens, 0, 1)
    }
  })
  const usedTokens = categories.reduce((sum, category) => sum + category.tokens, 0)
  const freeTokens = Math.max(0, windowTokens - usedTokens)
  const agentManaged = snapshot.contextManagement === 'sdk-managed'
  const agentReported = snapshot.occupancySource === 'agent'
  const softThresholdRatio = clamp(snapshot.softThresholdTokens / windowTokens, 0, 1)
  const hardThresholdRatio = clamp(snapshot.hardThresholdTokens / windowTokens, 0, 1)
  // Kun's own thresholds describe Kun's compaction. An Agent compacts at its
  // own point, which only an Agent-reported snapshot below the window carries.
  const thresholdKnown = !agentManaged || (agentReported && softThresholdRatio < hardThresholdRatio)
  return {
    windowTokens,
    totalWindowTokens,
    ...(maxInputTokens ? { maxInputTokens } : {}),
    usedTokens,
    freeTokens,
    usedRatio: clamp(usedTokens / windowTokens, 0, 1),
    freeRatio: clamp(freeTokens / windowTokens, 0, 1),
    softThresholdRatio,
    hardThresholdRatio,
    categories,
    estimated: true,
    nativeHistoryUnknown: agentManaged && snapshot.nativeHistory === 'unknown',
    agentManaged,
    agentReported,
    thresholdKnown,
    alertRatio: thresholdKnown ? softThresholdRatio : Math.max(hardThresholdRatio, 1)
  }
}
