import type {
  MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  MemoryFeedbackTiebreakerPlan
} from './memory-feedback-tiebreaker-contracts.js'
import {
  compactMemoryFeedbackTiebreakerDevelopmentReport,
  evaluateMemoryFeedbackTiebreakerDevelopment,
  type MemoryFeedbackTiebreakerDevelopmentReport
} from './memory-feedback-tiebreaker-development.js'

export type MemoryFeedbackTiebreakerResourceFailure =
  | 'evaluation-time'
  | 'trace-rankings'
  | 'evidence-bytes'

export type MemoryFeedbackTiebreakerResourceMeasurement = {
  elapsedMilliseconds: number
  maximumTraceRankings: number
  evidenceBytes: number
  failures: MemoryFeedbackTiebreakerResourceFailure[]
  passed: boolean
}

export function evaluateAndMeasureMemoryFeedbackTiebreakerResources(input: {
  fixture: Parameters<typeof evaluateMemoryFeedbackTiebreakerDevelopment>[0]['fixture']
  fixtureSha256: string
  manifestSha256: string
  calibration: Parameters<typeof evaluateMemoryFeedbackTiebreakerDevelopment>[0]['calibration']
  plan: MemoryFeedbackTiebreakerPlan
}): {
  report: MemoryFeedbackTiebreakerDevelopmentReport
  evidence: MemoryFeedbackTiebreakerDevelopmentArtifactValue
  measurement: MemoryFeedbackTiebreakerResourceMeasurement
} {
  const startedAt = performance.now()
  const report = evaluateMemoryFeedbackTiebreakerDevelopment(input)
  const elapsedMilliseconds = performance.now() - startedAt
  const evidence = compactMemoryFeedbackTiebreakerDevelopmentReport(report)
  const measurement = measureMemoryFeedbackTiebreakerResources({
    report,
    evidence,
    elapsedMilliseconds,
    plan: input.plan
  })
  return { report, evidence, measurement }
}

export function measureMemoryFeedbackTiebreakerResources(input: {
  report: MemoryFeedbackTiebreakerDevelopmentReport
  evidence: MemoryFeedbackTiebreakerDevelopmentArtifactValue
  elapsedMilliseconds: number
  plan: MemoryFeedbackTiebreakerPlan
}): MemoryFeedbackTiebreakerResourceMeasurement {
  const traceCounts = [
    ...input.report.foundation.cases.map((item) => item.rankings.length),
    ...input.report.candidates
      .flatMap((candidate) => candidate.cases)
      .map((item) => item.rankings.length)
  ]
  const maximumTraceRankings = Math.max(...traceCounts)
  const evidenceBytes = Buffer.byteLength(JSON.stringify(input.evidence), 'utf8')
  const failures: MemoryFeedbackTiebreakerResourceFailure[] = []
  if (input.elapsedMilliseconds > input.plan.gates.resource.maximumEvaluationMilliseconds) {
    failures.push('evaluation-time')
  }
  if (maximumTraceRankings > input.plan.gates.resource.maximumTraceRankings) {
    failures.push('trace-rankings')
  }
  if (evidenceBytes > input.plan.gates.resource.maximumEvidenceBytes) {
    failures.push('evidence-bytes')
  }
  return {
    elapsedMilliseconds: roundMilliseconds(input.elapsedMilliseconds),
    maximumTraceRankings,
    evidenceBytes,
    failures,
    passed: failures.length === 0
  }
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
