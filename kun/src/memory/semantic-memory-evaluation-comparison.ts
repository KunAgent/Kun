import { z } from 'zod'
import type {
  SemanticMemoryEvaluationReport,
  SemanticMemoryQueryResult
} from './semantic-memory-evaluation.js'

const BootstrapInterval = z.object({
  method: z.literal('paired-percentile'),
  pointEstimate: z.number(),
  lowerBound: z.number(),
  upperBound: z.number(),
  confidenceLevel: z.number().gt(0).lt(1),
  seed: z.number().int().min(0).max(0xffffffff),
  resamples: z.number().int().positive(),
  sampleSize: z.number().int().nonnegative()
}).strict()

const PairedQueryDelta = z.object({
  queryId: z.string().min(1),
  split: z.enum(['development', 'holdout']),
  category: z.string().min(1),
  expectedCount: z.number().int().nonnegative(),
  recallAtKDelta: z.number().optional(),
  reciprocalRankDelta: z.number().optional(),
  abstentionCorrectDelta: z.number().optional()
}).strict().superRefine((value, context) => {
  const ranked = value.expectedCount > 0
  if (ranked && (value.recallAtKDelta === undefined || value.reciprocalRankDelta === undefined)) {
    context.addIssue({ code: 'custom', message: 'ranked query is missing ranked deltas' })
  }
  if (!ranked && value.abstentionCorrectDelta === undefined) {
    context.addIssue({ code: 'custom', message: 'empty-expected query is missing abstention delta' })
  }
  if (ranked && value.abstentionCorrectDelta !== undefined) {
    context.addIssue({ code: 'custom', message: 'ranked query cannot include an abstention delta' })
  }
  if (!ranked && (value.recallAtKDelta !== undefined || value.reciprocalRankDelta !== undefined)) {
    context.addIssue({ code: 'custom', message: 'empty-expected query cannot include ranked deltas' })
  }
})

export const SemanticMemoryPairedComparisonReportSchema = z.object({
  schemaVersion: z.literal(2),
  reportKind: z.literal('paired-candidate-comparison'),
  dataset: z.object({
    id: z.string().min(1),
    recordsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    queriesSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    scoringVersion: z.number().int().positive(),
    limit: z.number().int().positive(),
    promptCharacterBudget: z.number().int().positive()
  }).strict(),
  baselineCandidateId: z.string().min(1),
  candidateId: z.string().min(1),
  results: z.array(PairedQueryDelta),
  metrics: z.object({
    recallAtKDelta: BootstrapInterval,
    meanReciprocalRankDelta: BootstrapInterval,
    abstentionAccuracyDelta: z.number(),
    abstentionSampleSize: z.number().int().nonnegative()
  }).strict()
}).strict()

export type SemanticMemoryBootstrapInterval = z.infer<typeof BootstrapInterval>
export type SemanticMemoryPairedComparisonReport = z.infer<typeof SemanticMemoryPairedComparisonReportSchema>

export function compareSemanticMemoryEvaluationReports(input: {
  baseline: SemanticMemoryEvaluationReport
  candidate: SemanticMemoryEvaluationReport
  bootstrap: {
    method: 'paired-percentile'
    seed: number
    resamples: number
    confidenceLevel: number
  }
}): SemanticMemoryPairedComparisonReport {
  assertComparableReports(input.baseline, input.candidate)
  const candidateByQuery = new Map(input.candidate.results.map((result) => [result.queryId, result]))
  const results = input.baseline.results.map((baseline) => {
    const candidate = candidateByQuery.get(baseline.queryId)!
    return pairedQueryDelta(baseline, candidate)
  })
  const recallDeltas = results.flatMap((result) =>
    result.recallAtKDelta === undefined ? [] : [result.recallAtKDelta]
  )
  const reciprocalRankDeltas = results.flatMap((result) =>
    result.reciprocalRankDelta === undefined ? [] : [result.reciprocalRankDelta]
  )
  const abstentionDeltas = results.flatMap((result) =>
    result.abstentionCorrectDelta === undefined ? [] : [result.abstentionCorrectDelta]
  )
  return SemanticMemoryPairedComparisonReportSchema.parse({
    schemaVersion: 2,
    reportKind: 'paired-candidate-comparison',
    dataset: {
      id: input.baseline.dataset.id,
      recordsSha256: input.baseline.dataset.recordsSha256,
      queriesSha256: input.baseline.dataset.queriesSha256,
      scoringVersion: input.baseline.dataset.scoringVersion,
      limit: input.baseline.dataset.limit,
      promptCharacterBudget: input.baseline.dataset.promptCharacterBudget
    },
    baselineCandidateId: input.baseline.candidate.id,
    candidateId: input.candidate.candidate.id,
    results,
    metrics: {
      recallAtKDelta: pairedBootstrapInterval(recallDeltas, input.bootstrap),
      meanReciprocalRankDelta: pairedBootstrapInterval(reciprocalRankDeltas, input.bootstrap),
      abstentionAccuracyDelta: mean(abstentionDeltas),
      abstentionSampleSize: abstentionDeltas.length
    }
  })
}

export function pairedBootstrapInterval(
  deltas: readonly number[],
  options: { method: 'paired-percentile'; seed: number; resamples: number; confidenceLevel: number }
): SemanticMemoryBootstrapInterval {
  const parsed = z.object({
    method: z.literal('paired-percentile'),
    seed: z.number().int().min(0).max(0xffffffff),
    resamples: z.number().int().positive(),
    confidenceLevel: z.number().gt(0).lt(1)
  }).strict().parse(options)
  if (deltas.some((value) => !Number.isFinite(value))) {
    throw new Error('paired bootstrap deltas must be finite')
  }
  if (deltas.length === 0) {
    return {
      method: parsed.method,
      pointEstimate: 0,
      lowerBound: 0,
      upperBound: 0,
      confidenceLevel: parsed.confidenceLevel,
      seed: parsed.seed,
      resamples: parsed.resamples,
      sampleSize: 0
    }
  }

  const random = mulberry32(parsed.seed)
  const samples = Array.from({ length: parsed.resamples }, () => {
    let total = 0
    for (let index = 0; index < deltas.length; index += 1) {
      total += deltas[Math.floor(random() * deltas.length)] ?? 0
    }
    return total / deltas.length
  }).sort((left, right) => left - right)
  const tail = (1 - parsed.confidenceLevel) / 2
  return {
    method: parsed.method,
    pointEstimate: round(mean(deltas)),
    lowerBound: round(quantile(samples, tail)),
    upperBound: round(quantile(samples, 1 - tail)),
    confidenceLevel: parsed.confidenceLevel,
    seed: parsed.seed,
    resamples: parsed.resamples,
    sampleSize: deltas.length
  }
}

function pairedQueryDelta(
  baseline: SemanticMemoryQueryResult,
  candidate: SemanticMemoryQueryResult
): z.infer<typeof PairedQueryDelta> {
  const common = {
    queryId: baseline.queryId,
    split: baseline.split,
    category: baseline.category,
    expectedCount: baseline.expectedCount
  }
  if (baseline.expectedCount === 0) {
    return {
      ...common,
      abstentionCorrectDelta: Number(candidate.abstentionCorrect) - Number(baseline.abstentionCorrect)
    }
  }
  return {
    ...common,
    recallAtKDelta: difference(candidate.recallAtK, baseline.recallAtK),
    reciprocalRankDelta: difference(candidate.reciprocalRank, baseline.reciprocalRank)
  }
}

function assertComparableReports(
  baseline: SemanticMemoryEvaluationReport,
  candidate: SemanticMemoryEvaluationReport
): void {
  if (baseline.candidate.kind !== 'lexical') throw new Error('comparison baseline must be lexical')
  const datasetFields = ['id', 'recordsSha256', 'queriesSha256', 'scoringVersion', 'evaluationNow', 'limit', 'promptCharacterBudget'] as const
  const mismatches = datasetFields.filter((key) => baseline.dataset[key] !== candidate.dataset[key])
  if (mismatches.length > 0) throw new Error(`semantic Memory comparison dataset mismatch: ${mismatches.join(', ')}`)
  if (baseline.results.length !== candidate.results.length) {
    throw new Error('semantic Memory comparison query count mismatch')
  }
  const candidateByQuery = new Map(candidate.results.map((result) => [result.queryId, result]))
  if (candidateByQuery.size !== candidate.results.length) {
    throw new Error('semantic Memory candidate report contains duplicate query ids')
  }
  for (const expected of baseline.results) {
    const actual = candidateByQuery.get(expected.queryId)
    if (!actual) throw new Error(`semantic Memory candidate report is missing ${expected.queryId}`)
    if (actual.split !== expected.split || actual.category !== expected.category || actual.expectedCount !== expected.expectedCount) {
      throw new Error(`semantic Memory query metadata mismatch for ${expected.queryId}`)
    }
  }
}

function difference(left: number | undefined, right: number | undefined): number {
  if (left === undefined || right === undefined) throw new Error('ranked query is missing a metric')
  return round(left - right)
}

function quantile(sorted: readonly number[], value: number): number {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(value * sorted.length)))
  return sorted[index] ?? 0
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : round(values.reduce((total, value) => total + value, 0) / values.length)
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
}
