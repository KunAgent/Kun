import type {
  MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  MemoryFeedbackTiebreakerPlan
} from './memory-feedback-tiebreaker-contracts.js'

type Configuration = MemoryFeedbackTiebreakerDevelopmentArtifactValue['configurations'][number]

export function evaluateMemoryFeedbackTiebreakerGates(
  foundation: MemoryFeedbackTiebreakerDevelopmentArtifactValue['foundation'],
  candidate: Pick<Configuration, 'metrics' | 'bootstrapLowerBounds'>,
  plan: MemoryFeedbackTiebreakerPlan
): Configuration['gates'] {
  const { metrics, bootstrapLowerBounds: bounds } = candidate
  const { localBenefit: local, globalNonRegression: global, safety: safe } = plan.gates
  const localBenefit = metrics.pairAccuracy - foundation.pairAccuracy >= local.minimumPairAccuracyGain &&
    bounds.pairAccuracyGain >= local.minimumPairAccuracyGainLowerBound
  const globalNonRegression = bounds.recallGain >= global.minimumRecallGainLowerBound &&
    bounds.mrrGain >= global.minimumMrrGainLowerBound &&
    foundation.precisionAtK - metrics.precisionAtK <= global.maximumPrecisionDecline &&
    foundation.abstentionAccuracy - metrics.abstentionAccuracy <= global.maximumAbstentionDecline
  const safety = metrics.explicitForbiddenSelections <= safe.maximumExplicitForbiddenSelections &&
    metrics.authorizationOrLifecycleViolations <= safe.maximumAuthorizationOrLifecycleViolations
  return { localBenefit, globalNonRegression, safety, passed: localBenefit && globalNonRegression && safety }
}
