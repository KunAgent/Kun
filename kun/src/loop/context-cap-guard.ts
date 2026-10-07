import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { capabilityFieldKnown } from '../contracts/model-metadata-evidence.js'
import { contextCapExceededAction, type ContextCapExceededReason } from './context-cap-exceeded-action.js'

/**
 * Pages a source tool may return when the window is only an estimate and the
 * request already outgrew it. Large enough for a useful read, small enough
 * that a tool result cannot dominate the next request.
 */
const ASSUMED_WINDOW_SOURCE_RESULT_FLOOR_TOKENS = 8_000

/**
 * True when the window is the runtime's conservative placeholder (the model
 * has no registered profile) rather than a declared or verified fact.
 */
export function contextWindowIsAssumed(capabilities: ModelCapabilityMetadata): boolean {
  return !capabilityFieldKnown(capabilities as unknown as Record<string, unknown>, 'contextWindowTokens')
}

type CapBudget = {
  inputTokens: number
  outputBudgetTokens: number
  outputReserveTokens: number
  requestHardCapTokens: number
}

/**
 * An unregistered model's 32k window is a guess. Failing every request
 * against a guess bricks the conversation for models whose real window is
 * larger (the tool catalog alone can take 22k tokens), so the pre-send guard
 * turns advisory there: keep the bounded output reservation and let the
 * provider's own overflow error drive compaction recovery. Returns the output
 * budget to forward, or `undefined` when the strict guard applies.
 */
export function assumedWindowOutputBudget(
  capabilities: ModelCapabilityMetadata,
  budget: CapBudget
): number | undefined {
  if (!contextWindowIsAssumed(capabilities)) return undefined
  if (budget.inputTokens + budget.outputBudgetTokens <= budget.requestHardCapTokens) return undefined
  return budget.outputReserveTokens
}

/** Tokens a source tool may use for its result without overflowing the next request. */
export function sourceResultBudgetTokensFor(
  capabilities: ModelCapabilityMetadata,
  budget: Omit<CapBudget, 'outputBudgetTokens'>
): number {
  const fits = Math.max(0, budget.requestHardCapTokens - budget.inputTokens - budget.outputReserveTokens)
  return contextWindowIsAssumed(capabilities)
    ? Math.max(fits, ASSUMED_WINDOW_SOURCE_RESULT_FLOOR_TOKENS)
    : fits
}

/** Reason and user-facing text for a request that still breaks a declared cap. */
export function describeContextCapFailure(input: CapBudget & {
  fallbackCompactionAttempted: boolean
  fallbackCompactionApplied: boolean
}): { reason: ContextCapExceededReason; message: string } {
  const { inputTokens, outputBudgetTokens, requestHardCapTokens } = input
  const overBy = inputTokens + outputBudgetTokens - requestHardCapTokens
  const reason: ContextCapExceededReason = outputBudgetTokens > requestHardCapTokens
    ? 'output_budget_exceeds_cap'
    : !input.fallbackCompactionAttempted
      ? 'request_too_large'
      : input.fallbackCompactionApplied
        ? 'still_exceeds_after_compaction'
        : 'no_compactable_history'
  return {
    reason,
    message:
      `request exceeds the ${requestHardCapTokens}-token context cap ` +
      `(${inputTokens} input + ${outputBudgetTokens} output budget; over by ${overBy}); ` +
      `${reason}. ${contextCapExceededAction(reason)}`
  }
}
