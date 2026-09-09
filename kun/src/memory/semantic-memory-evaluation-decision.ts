import type { SemanticMemoryCandidateMetadata } from './semantic-memory-evaluation.js'
import type { SemanticMemoryEvaluationManifest } from './semantic-memory-evaluation-dataset.js'
import type { SemanticMemoryResourceSummary } from './semantic-memory-evaluation-resources.js'

export type SemanticMemoryDecisionGate = {
  id: string
  operator: 'eq' | 'gte' | 'lte'
  expected: number | boolean
  actual: number | boolean
  passed: boolean
}

export type SemanticMemoryDecisionResult = {
  decision: 'go' | 'no-go'
  gates: SemanticMemoryDecisionGate[]
  failedGateIds: string[]
}

type DecisionMetrics = {
  recallAtK: number
  precisionAtK: number
  meanReciprocalRank: number
  abstentionAccuracy: number
  scopeLeaks: number
  lifecycleLeaks: number
  authorityViolations: number
  unknownSelections: number
}

export function semanticMemoryLockedCandidateMetadata(
  manifest: SemanticMemoryEvaluationManifest
): SemanticMemoryCandidateMetadata {
  const locked = manifest.candidateLock.candidate
  return {
    id: locked.id,
    kind: locked.kind,
    version: locked.version,
    runtime: locked.runtime,
    license: locked.license,
    artifactSha256: locked.artifactSha256,
    dimensions: locked.dimensions,
    normalization: locked.normalization,
    parameters: locked.parameters,
    platforms: locked.platforms
  }
}

export function assertSemanticMemoryCandidateMatchesLock(
  manifest: SemanticMemoryEvaluationManifest,
  candidate: SemanticMemoryCandidateMetadata
): void {
  const expected = semanticMemoryLockedCandidateMetadata(manifest)
  const differences = Object.keys(expected).filter((key) =>
    canonical(expected[key as keyof typeof expected]) !== canonical(candidate[key as keyof typeof candidate])
  )
  if (differences.length > 0) {
    throw new Error(`semantic Memory candidate differs from lock: ${differences.join(', ')}`)
  }
}

export function evaluateSemanticMemoryDecision(input: {
  manifest: SemanticMemoryEvaluationManifest
  lexical: {
    overall: Pick<DecisionMetrics, 'precisionAtK'>
    holdout: Pick<DecisionMetrics, 'recallAtK' | 'meanReciprocalRank'>
    lexicalControlRecallAtK: number
  }
  candidate: {
    overall: DecisionMetrics
    holdout: Pick<DecisionMetrics, 'recallAtK' | 'meanReciprocalRank'>
    lexicalControlRecallAtK: number
    networkAttempts: number
    fallbackMismatches: number
  }
  resources: SemanticMemoryResourceSummary
  determinism: { runHashes: readonly string[]; maximumNumericDelta: number }
  requiredPlatformSupport: boolean
}): SemanticMemoryDecisionResult {
  const thresholds = input.manifest.thresholds
  const gates = [
    equalGate('scope-leaks', thresholds.scopeLeaks, input.candidate.overall.scopeLeaks),
    equalGate('lifecycle-leaks', thresholds.lifecycleLeaks, input.candidate.overall.lifecycleLeaks),
    equalGate('authority-violations', thresholds.authorityViolations, input.candidate.overall.authorityViolations),
    equalGate('unknown-selections', 0, input.candidate.overall.unknownSelections),
    equalGate('network-attempts', thresholds.networkAttempts, input.candidate.networkAttempts),
    equalGate('fallback-mismatches', thresholds.fallbackMismatches, input.candidate.fallbackMismatches),
    minimumGate('empty-result-accuracy', thresholds.emptyResultAccuracy, input.candidate.overall.abstentionAccuracy),
    minimumGate(
      'holdout-recall-gain',
      thresholds.semanticHoldoutRecallGain,
      difference(input.candidate.holdout.recallAtK, input.lexical.holdout.recallAtK)
    ),
    minimumGate(
      'holdout-mrr-gain',
      thresholds.semanticHoldoutMrrGain,
      difference(input.candidate.holdout.meanReciprocalRank, input.lexical.holdout.meanReciprocalRank)
    ),
    maximumGate(
      'overall-precision-decline',
      thresholds.maximumOverallPrecisionDecline,
      difference(input.lexical.overall.precisionAtK, input.candidate.overall.precisionAtK)
    ),
    maximumGate(
      'lexical-control-regression',
      thresholds.maximumLexicalControlRegression,
      difference(input.lexical.lexicalControlRecallAtK, input.candidate.lexicalControlRecallAtK)
    ),
    minimumGate('deterministic-run-count', thresholds.deterministicRuns, input.determinism.runHashes.length),
    equalGate('deterministic-output-hashes', true, new Set(input.determinism.runHashes).size === 1),
    maximumGate('deterministic-numeric-delta', input.manifest.candidateLock.numericTolerance, input.determinism.maximumNumericDelta),
    maximumGate('model-bytes', thresholds.maximumCompressedModelBytes, input.resources.modelBytes),
    maximumGate('warm-query-p95-ms', thresholds.maximumWarmQueryP95Ms, input.resources.warmQueryP95Ms),
    maximumGate('cold-readiness-ms', thresholds.maximumColdReadinessMs, input.resources.coldReadinessMs),
    maximumGate(
      'ten-thousand-record-build-ms',
      thresholds.maximumTenThousandRecordBuildMs,
      input.resources.tenThousandRecordBuildMs
    ),
    maximumGate(
      'additional-peak-rss-bytes',
      thresholds.maximumAdditionalPeakRssBytes,
      input.resources.additionalPeakRssBytes
    ),
    maximumGate(
      'ten-thousand-record-index-bytes',
      thresholds.maximumTenThousandRecordIndexBytes,
      input.resources.indexBytes
    ),
    equalGate('required-platform-support', true, input.requiredPlatformSupport)
  ]
  const failedGateIds = gates.filter((gate) => !gate.passed).map((gate) => gate.id)
  return { decision: failedGateIds.length === 0 ? 'go' : 'no-go', gates, failedGateIds }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function equalGate(id: string, expected: number | boolean, actual: number | boolean): SemanticMemoryDecisionGate {
  return { id, operator: 'eq', expected, actual, passed: actual === expected }
}

function minimumGate(id: string, expected: number, actual: number): SemanticMemoryDecisionGate {
  return { id, operator: 'gte', expected, actual, passed: actual >= expected }
}

function maximumGate(id: string, expected: number, actual: number): SemanticMemoryDecisionGate {
  return { id, operator: 'lte', expected, actual, passed: actual <= expected }
}

function difference(left: number, right: number): number {
  return Math.round((left - right) * 1_000_000) / 1_000_000
}
