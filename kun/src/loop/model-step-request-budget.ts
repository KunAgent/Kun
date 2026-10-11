import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { effectiveOutputBudgetTokens, ordinaryOutputReserveTokens } from './model-request-composer.js'

/** Separate input allowance, total context safety margin, and the bounded compaction reserve. */
export function modelStepRequestBudget(capability: ModelCapabilityMetadata, fallbackHardCap: number) {
  const requestHardCapTokens = capability.contextWindowTokens
    ? Math.floor(capability.contextWindowTokens * 0.85) : fallbackHardCap
  const declaredOutputBudgetAbsent = capability.endpointFormat === 'messages' && capability.maxOutputTokens === undefined
  const limits = {
    contextCapTokens: requestHardCapTokens,
    ...(capability.maxOutputTokens !== undefined ? { declaredMaxOutputTokens: capability.maxOutputTokens } : {})
  }
  return {
    requestMaxInputTokens: capability.maxInputTokens,
    requestHardCapTokens,
    outputReserveTokens: declaredOutputBudgetAbsent ? 0 : ordinaryOutputReserveTokens({ ...limits, inputTokens: 0 }),
    effectiveBudget: (inputTokens: number): number => declaredOutputBudgetAbsent
      ? 0 : effectiveOutputBudgetTokens({ ...limits, inputTokens })
  }
}
