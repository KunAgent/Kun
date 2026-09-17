import {
  evaluateMemoryFeedbackCandidate,
  type MemoryFeedbackEvaluationMetrics,
  type MemoryFeedbackEvaluationResult,
  type MemoryFeedbackEvaluationTrace
} from './memory-feedback-evaluation.js'
import type { MemoryFeedbackFixtureDataset } from './memory-feedback-fixtures.js'
import type { MemoryFeedbackEvaluationPlan } from './memory-feedback-evaluation-plan.js'

export type MemoryFeedbackMetricDelta = {
  recallAtK: number
  precisionAtK: number
  meanReciprocalRank: number
}

export type MemoryFeedbackGateResult = {
  relevance: boolean
  safety: boolean
  privacy: boolean
  resource: boolean
  passed: boolean
  reasons: string[]
}

export type MemoryFeedbackPartitionResult = {
  status: 'run' | 'not-run'
  result?: MemoryFeedbackEvaluationResult
  delta?: MemoryFeedbackMetricDelta
  bootstrap?: {
    recallGainLowerBound: number
    mrrGainLowerBound: number
  }
  gates: MemoryFeedbackGateResult
}

export type MemoryFeedbackEvaluationWorkflowResult = {
  decisionId: string
  evaluationVersion: string
  fixtureSha256: string
  development: MemoryFeedbackPartitionResult
  holdout: MemoryFeedbackPartitionResult
  candidateLocked: boolean
  holdoutRunCount: 0 | 1
  decision: 'go' | 'no-go'
  reasons: string[]
}

/**
 * Run the pre-registered dev-then-holdout protocol. A failed development gate
 * stops before holdout; a passing candidate gets exactly one holdout execution.
 */
export function runMemoryFeedbackEvaluationWorkflow(input: {
  plan: MemoryFeedbackEvaluationPlan
  fixture: MemoryFeedbackFixtureDataset
}): MemoryFeedbackEvaluationWorkflowResult {
  const { plan, fixture } = input
  const developmentFixture = partitionFixture(fixture, plan.partitions.development)
  const developmentResult = evaluateMemoryFeedbackCandidate(developmentFixture)
  const development = evaluatePartition('development', developmentResult, developmentFixture, plan)
  const reasons = [...development.gates.reasons]

  if (!development.gates.passed) {
    reasons.push('development gates failed; holdout was not run')
    return {
      decisionId: plan.decisionId,
      evaluationVersion: plan.evaluationVersion,
      fixtureSha256: fixture.fixtureSha256,
      development,
      holdout: notRunPartition('development candidate was not locked'),
      candidateLocked: false,
      holdoutRunCount: 0,
      decision: 'no-go',
      reasons
    }
  }

  const holdoutFixture = partitionFixture(fixture, plan.partitions.holdout)
  const holdoutResult = evaluateMemoryFeedbackCandidate(holdoutFixture)
  const holdout = evaluatePartition('holdout', holdoutResult, holdoutFixture, plan)
  const holdoutBootstrap = pairedBootstrapLowerBounds(
    holdoutFixture,
    holdoutResult,
    plan.bootstrap.seed,
    plan.bootstrap.resamples,
    plan.bootstrap.confidenceLevel
  )
  const holdoutWithBootstrap = {
    ...holdout,
    bootstrap: holdoutBootstrap,
    gates: evaluateHoldoutGates(holdout, holdoutBootstrap, plan)
  }
  reasons.push(...holdoutWithBootstrap.gates.reasons)
  return {
    decisionId: plan.decisionId,
    evaluationVersion: plan.evaluationVersion,
    fixtureSha256: fixture.fixtureSha256,
    development,
    holdout: holdoutWithBootstrap,
    candidateLocked: true,
    holdoutRunCount: 1,
    decision: holdoutWithBootstrap.gates.passed ? 'go' : 'no-go',
    reasons
  }
}

function evaluatePartition(
  partition: 'development' | 'holdout',
  result: MemoryFeedbackEvaluationResult,
  fixture: MemoryFeedbackFixtureDataset,
  plan: MemoryFeedbackEvaluationPlan
): MemoryFeedbackPartitionResult {
  const delta = metricDelta(result.foundation, result.candidate)
  const safety = result.candidate.forbiddenSelections === 0 &&
    plan.gates.safety.productionRankingChanges === 0
  const privacy = tracesArePrivate(result.traces, fixture) &&
    plan.gates.privacy.queryTextInTrace === false &&
    plan.gates.privacy.memoryContentInTrace === false &&
    plan.gates.privacy.localPathInTrace === false &&
    plan.gates.privacy.credentialInTrace === false
  const resource = result.traces.every((trace) => trace.rankings.length <= plan.gates.resource.maximumTraceRankings) &&
    result.traces.length === fixture.cases.length * 2
  const gate = partition === 'development'
    ? plan.gates.development
    : plan.gates.holdout
  const relevance = delta.recallAtK >= ('minimumRecallGain' in gate ? gate.minimumRecallGain : 0) &&
    delta.meanReciprocalRank >= ('minimumMrrGain' in gate ? gate.minimumMrrGain : 0) &&
    -delta.precisionAtK <= gate.maximumPrecisionDecline &&
    result.candidate.forbiddenSelections <= gate.maximumForbiddenSelections
  const reasons: string[] = []
  if (!relevance) reasons.push(`${partition} relevance/precision gate failed`)
  if (!safety) reasons.push(`${partition} safety gate failed`)
  if (!privacy) reasons.push(`${partition} privacy gate failed`)
  if (!resource) reasons.push(`${partition} resource/determinism gate failed`)
  return {
    status: 'run',
    result,
    delta,
    gates: { relevance, safety, privacy, resource, passed: relevance && safety && privacy && resource, reasons }
  }
}

function evaluateHoldoutGates(
  holdout: MemoryFeedbackPartitionResult,
  bootstrap: NonNullable<MemoryFeedbackPartitionResult['bootstrap']>,
  plan: MemoryFeedbackEvaluationPlan
): MemoryFeedbackGateResult {
  const gates = plan.gates.holdout
  const relevance = Boolean(holdout.delta &&
    bootstrap.recallGainLowerBound >= gates.minimumRecallGainLowerBound &&
    bootstrap.mrrGainLowerBound >= gates.minimumMrrGainLowerBound &&
    -holdout.delta.precisionAtK <= gates.maximumPrecisionDecline &&
    (holdout.result?.candidate.forbiddenSelections ?? 0) <= gates.maximumForbiddenSelections)
  const base = holdout.gates
  const reasons = [...base.reasons]
  if (!relevance) reasons.push('holdout bootstrap relevance gate failed')
  return { ...base, relevance, passed: relevance && base.safety && base.privacy && base.resource, reasons }
}

function pairedBootstrapLowerBounds(
  fixture: MemoryFeedbackFixtureDataset,
  result: MemoryFeedbackEvaluationResult,
  seed: number,
  resamples: number,
  confidenceLevel: number
): { recallGainLowerBound: number; mrrGainLowerBound: number } {
  const foundation = new Map(result.traces.filter((trace) => trace.candidate === 'foundation').map((trace) => [trace.caseId, trace]))
  const candidate = new Map(result.traces.filter((trace) => trace.candidate === 'feedback').map((trace) => [trace.caseId, trace]))
  const differences = fixture.cases.map((item) => {
    const baseline = traceMetrics(item, foundation.get(item.id)?.selectedIds ?? [])
    const feedback = traceMetrics(item, candidate.get(item.id)?.selectedIds ?? [])
    return {
      recall: feedback.recallAtK - baseline.recallAtK,
      mrr: feedback.meanReciprocalRank - baseline.meanReciprocalRank
    }
  })
  let state = seed >>> 0
  const recallSamples: number[] = []
  const mrrSamples: number[] = []
  for (let run = 0; run < resamples; run += 1) {
    let recall = 0
    let mrr = 0
    for (let index = 0; index < differences.length; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      const difference = differences[state % differences.length]!
      recall += difference.recall
      mrr += difference.mrr
    }
    recallSamples.push(recall / differences.length)
    mrrSamples.push(mrr / differences.length)
  }
  const percentile = Math.max(0, Math.min(resamples - 1, Math.floor((1 - confidenceLevel) * resamples)))
  recallSamples.sort((left, right) => left - right)
  mrrSamples.sort((left, right) => left - right)
  return {
    recallGainLowerBound: round(recallSamples[percentile] ?? 0),
    mrrGainLowerBound: round(mrrSamples[percentile] ?? 0)
  }
}

function partitionFixture(dataset: MemoryFeedbackFixtureDataset, caseIds: readonly string[]): MemoryFeedbackFixtureDataset {
  const allowed = new Set(caseIds)
  return { ...dataset, cases: dataset.cases.filter((item) => allowed.has(item.id)) }
}

function metricDelta(
  foundation: MemoryFeedbackEvaluationMetrics,
  candidate: MemoryFeedbackEvaluationMetrics
): MemoryFeedbackMetricDelta {
  return {
    recallAtK: round(candidate.recallAtK - foundation.recallAtK),
    precisionAtK: round(candidate.precisionAtK - foundation.precisionAtK),
    meanReciprocalRank: round(candidate.meanReciprocalRank - foundation.meanReciprocalRank)
  }
}

function traceMetrics(fixture: MemoryFeedbackFixtureDataset['cases'][number], selectedIds: readonly string[]): MemoryFeedbackEvaluationMetrics {
  const expected = new Set(fixture.expectedIds)
  const relevant = selectedIds.filter((id) => expected.has(id)).length
  const first = selectedIds.findIndex((id) => expected.has(id))
  return {
    recallAtK: expected.size === 0 ? 1 : relevant / expected.size,
    precisionAtK: selectedIds.length === 0 ? 0 : relevant / selectedIds.length,
    meanReciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    forbiddenSelections: selectedIds.filter((id) => fixture.forbiddenIds.includes(id)).length,
    queryCount: 1
  }
}

// Traces may carry record/case ids and bounded numbers only. Every content,
// scope, provenance, or query value present in the frozen dataset is forbidden.
function tracesArePrivate(
  traces: readonly MemoryFeedbackEvaluationTrace[],
  fixture: MemoryFeedbackFixtureDataset
): boolean {
  const serialized = JSON.stringify(traces)
  return !forbiddenTraceValues(fixture).some((value) => serialized.includes(value)) &&
    traces.every((trace) => trace.rankings.every((item) => Object.values(item.features).every((value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)))
}

function forbiddenTraceValues(fixture: MemoryFeedbackFixtureDataset): string[] {
  const values = new Set<string>()
  for (const fixtureCase of fixture.cases) values.add(fixtureCase.query)
  for (const record of fixture.records) {
    for (const value of [
      record.content, record.workspace, record.project, record.correctedFrom,
      record.sourceThreadId, record.sourceTurnId, record.provenance?.file, record.provenance?.origin
    ]) {
      if (value) values.add(value)
    }
    for (const source of record.sources ?? []) {
      for (const value of [source.id, source.locator, source.excerpt, source.threadId, source.turnId, source.itemId]) {
        if (value) values.add(value)
      }
    }
  }
  for (const event of fixture.events) values.add(event.id)
  return [...values].filter((value) => value.length >= 4)
}

function notRunPartition(reason: string): MemoryFeedbackPartitionResult {
  return {
    status: 'not-run',
    gates: { relevance: false, safety: true, privacy: true, resource: true, passed: false, reasons: [reason] }
  }
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
