import type { DistillationDecision } from '../contracts/memory-distillation.js'
import type { MemoryDistillationFixtureCase } from './memory-distillation-fixtures.js'
import { decideMemoryCandidate } from './memory-distillation.js'

export type MemoryDistillationEvaluationMetrics = {
  decisionAccuracy: number
  unsafeNonSkipCount: number
  duplicateCreateCount: number
  sourceCompleteness: number
  caseCount: number
}

export function evaluateMemoryDistillation(
  cases: readonly MemoryDistillationFixtureCase[],
  nowMs = Date.now()
): MemoryDistillationEvaluationMetrics {
  if (cases.length === 0) throw new Error('memory distillation evaluation requires fixtures')
  let correct = 0
  let unsafeNonSkipCount = 0
  let duplicateCreateCount = 0
  let completeSourceDecisions = 0
  let nonSkipDecisions = 0

  for (const fixture of cases) {
    const decision = decideMemoryCandidate(
      fixture.assessment,
      fixture.existing,
      fixture.evidence,
      nowMs
    )
    if (matchesExpectedDecision(decision, fixture.expected)) correct += 1
    if (fixture.unsafe && decision.action !== 'skip') unsafeNonSkipCount += 1
    if (fixture.duplicate && decision.action === 'create') duplicateCreateCount += 1
    if (decision.action !== 'skip') {
      nonSkipDecisions += 1
      if (decision.candidate.sources.every((source) => source.threadId && source.turnId)) {
        completeSourceDecisions += 1
      }
    }
  }

  return {
    decisionAccuracy: ratio(correct, cases.length),
    unsafeNonSkipCount,
    duplicateCreateCount,
    sourceCompleteness: ratio(completeSourceDecisions, nonSkipDecisions),
    caseCount: cases.length
  }
}

export function formatMemoryDistillationEvaluation(
  metrics: MemoryDistillationEvaluationMetrics
): string {
  return JSON.stringify({
    dataset: 'checked-in-anonymous-fixtures',
    metrics
  }, null, 2)
}

function matchesExpectedDecision(
  actual: DistillationDecision,
  expected: MemoryDistillationFixtureCase['expected']
): boolean {
  if (actual.action !== expected.action) return false
  if (actual.action === 'skip') return actual.reason === expected.reason
  if (actual.action === 'create') return true
  return actual.memoryId === expected.memoryId
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1
  return Math.round((numerator / denominator) * 1_000) / 1_000
}
