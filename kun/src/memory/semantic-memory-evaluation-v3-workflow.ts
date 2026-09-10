import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  runSemanticMemoryEvaluation,
  type SemanticMemoryCandidate,
  type SemanticMemoryCandidateMetadata,
  type SemanticMemoryEvaluationReport
} from './semantic-memory-evaluation.js'
import type { SemanticMemoryV3EvaluationDataset } from './semantic-memory-evaluation-v3-dataset.js'
import { compareSemanticMemoryV3EvaluationReports, type SemanticMemoryV3PairedComparisonReport } from './semantic-memory-evaluation-v3-comparison.js'
import {
  parseSemanticMemoryV3HoldoutLock,
  type SemanticMemoryV3HoldoutLock
} from './semantic-memory-evaluation-v3-lock.js'

const GridConfiguration = z.object({
  id: z.string().regex(/^v3-[a-z0-9-]+$/u),
  minimumSimilarity: z.number().min(-1).max(1),
  marginGap: z.number().min(0).max(1),
  semanticWeight: z.number().positive(),
  lexicalWeight: z.number().positive(),
  rankConstant: z.number().int().positive()
}).strict()

export type SemanticMemoryV3GridConfiguration = z.infer<typeof GridConfiguration>
export type SemanticMemoryV3DevelopmentGridResult = {
  gridSha256: string
  entries: Array<{
    configuration: SemanticMemoryV3GridConfiguration
    report?: SemanticMemoryEvaluationReport
    error?: string
  }>
}

export type SemanticMemoryV3DevelopmentSelection = {
  configuration: SemanticMemoryV3GridConfiguration
  report: SemanticMemoryEvaluationReport
  comparison: SemanticMemoryV3PairedComparisonReport
}

export function semanticMemoryV3DevelopmentGridConfigurations(
  dataset: SemanticMemoryV3EvaluationDataset
): SemanticMemoryV3GridConfiguration[] {
  const configurations: SemanticMemoryV3GridConfiguration[] = []
  for (const minimumSimilarity of dataset.manifest.developmentGrid.minimumSimilarities) {
    for (const marginGap of dataset.manifest.developmentGrid.marginGaps) {
      for (const semanticWeight of dataset.manifest.developmentGrid.semanticWeights) {
        for (const lexicalWeight of dataset.manifest.developmentGrid.lexicalWeights) {
          for (const rankConstant of dataset.manifest.developmentGrid.rankConstants) {
            configurations.push(GridConfiguration.parse({
              id: gridConfigurationId({ minimumSimilarity, marginGap, semanticWeight, lexicalWeight, rankConstant }),
              minimumSimilarity,
              marginGap,
              semanticWeight,
              lexicalWeight,
              rankConstant
            }))
          }
        }
      }
    }
  }
  if (new Set(configurations.map((configuration) => configuration.id)).size !== configurations.length) {
    throw new Error('semantic Memory v3 development grid contains duplicate configurations')
  }
  return configurations
}

export async function runSemanticMemoryV3DevelopmentGrid(input: {
  dataset: SemanticMemoryV3EvaluationDataset
  createCandidate: (configuration: SemanticMemoryV3GridConfiguration) => SemanticMemoryCandidate | Promise<SemanticMemoryCandidate>
}): Promise<SemanticMemoryV3DevelopmentGridResult> {
  const entries: SemanticMemoryV3DevelopmentGridResult['entries'] = []
  for (const configuration of semanticMemoryV3DevelopmentGridConfigurations(input.dataset)) {
    try {
      const candidate = await input.createCandidate(configuration)
      assertCandidateMatchesConfiguration(candidate.metadata, configuration)
      const report = await runSemanticMemoryEvaluation({ dataset: input.dataset, candidate, split: 'development' })
      if (report.results.some((result) => result.split !== 'development')) {
        throw new Error('semantic Memory v3 development grid exposed a holdout result')
      }
      entries.push({ configuration, report })
    } catch (error) {
      entries.push({ configuration, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return {
    gridSha256: semanticMemoryV3DevelopmentGridSha256(input.dataset),
    entries
  }
}

export function selectSemanticMemoryV3DevelopmentCandidate(input: {
  dataset: SemanticMemoryV3EvaluationDataset
  baseline: SemanticMemoryEvaluationReport
  grid: SemanticMemoryV3DevelopmentGridResult
}): SemanticMemoryV3DevelopmentSelection | undefined {
  const zeroOverlapQueryIds = new Set(
    input.dataset.queries
      .filter((query) => query.split === 'development' && query.zeroLexicalOverlap)
      .map((query) => query.id)
  )
  const candidates = input.grid.entries.flatMap((entry) => {
    if (!entry.report || entry.error) return []
    const comparison = compareSemanticMemoryV3EvaluationReports({
      baseline: input.baseline,
      candidate: entry.report,
      zeroOverlapQueryIds,
      bootstrap: input.dataset.manifest.bootstrap
    })
    const thresholds = input.dataset.manifest.thresholds
    const passes = entry.report.safetyGatePassed &&
      entry.report.metrics.abstentionAccuracy >= thresholds.emptyResultAccuracy &&
      comparison.metrics.recallAtKDelta.lowerBound >= thresholds.minimumRecallGainLowerBound &&
      comparison.metrics.meanReciprocalRankDelta.lowerBound >= thresholds.minimumMrrGainLowerBound &&
      comparison.metrics.precisionAtKDelta.lowerBound >= -thresholds.maximumOverallPrecisionDecline &&
      comparison.metrics.zeroOverlapRecallAtKDelta.lowerBound >= -thresholds.maximumZeroOverlapRecallDecline
    return passes ? [{ configuration: entry.configuration, report: entry.report, comparison }] : []
  })
  return candidates.sort((left, right) =>
    right.comparison.metrics.recallAtKDelta.lowerBound - left.comparison.metrics.recallAtKDelta.lowerBound ||
    right.comparison.metrics.meanReciprocalRankDelta.lowerBound - left.comparison.metrics.meanReciprocalRankDelta.lowerBound ||
    right.comparison.metrics.precisionAtKDelta.lowerBound - left.comparison.metrics.precisionAtKDelta.lowerBound ||
    left.configuration.id.localeCompare(right.configuration.id)
  )[0]
}

export function semanticMemoryV3DevelopmentEvidenceSha256(
  grid: SemanticMemoryV3DevelopmentGridResult
): string {
  const snapshot = grid.entries.map((entry) => ({
    configuration: entry.configuration,
    error: entry.error,
    report: entry.report ? {
      candidate: entry.report.candidate,
      results: entry.report.results.map(({ latencyMs: _latencyMs, ...result }) => result),
      metrics: withoutTiming(entry.report.metrics),
      breakdowns: entry.report.breakdowns,
      safetyGatePassed: entry.report.safetyGatePassed,
      networkAttempts: entry.report.networkAttempts,
      fallbackMismatches: entry.report.fallbackMismatches
    } : undefined
  }))
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export function semanticMemoryV3DevelopmentGridSha256(
  dataset: SemanticMemoryV3EvaluationDataset
): string {
  const text = JSON.stringify(semanticMemoryV3DevelopmentGridConfigurations(dataset))
  return createHash('sha256').update(text).digest('hex')
}

export function assertSemanticMemoryV3HoldoutLock(input: {
  dataset: SemanticMemoryV3EvaluationDataset
  model: SemanticMemoryV3EvaluationDataset['manifest']['candidateIdentity']
  baseline: Pick<SemanticMemoryCandidateMetadata, 'id' | 'version' | 'parameters'>
  candidate: Pick<SemanticMemoryCandidateMetadata, 'id' | 'version' | 'parameters'>
  lock: unknown
}): SemanticMemoryV3HoldoutLock {
  const lock = parseSemanticMemoryV3HoldoutLock(input.lock)
  const mismatches: string[] = []
  if (lock.dataset.id !== input.dataset.manifest.datasetId) mismatches.push('dataset.id')
  if (lock.dataset.recordsSha256 !== input.dataset.manifest.hashes.recordsSha256) mismatches.push('dataset.recordsSha256')
  if (lock.dataset.queriesSha256 !== input.dataset.manifest.hashes.queriesSha256) mismatches.push('dataset.queriesSha256')
  if (lock.dataset.manifestSha256 !== input.dataset.sourceHashes.manifest) mismatches.push('dataset.manifestSha256')
  if (JSON.stringify(lock.model) !== JSON.stringify(input.model)) mismatches.push('model')
  if (JSON.stringify(lock.baseline) !== JSON.stringify({ candidateId: input.baseline.id, version: input.baseline.version, parameters: input.baseline.parameters })) mismatches.push('baseline')
  if (JSON.stringify(lock.candidate) !== JSON.stringify({ candidateId: input.candidate.id, version: input.candidate.version, parameters: input.candidate.parameters })) mismatches.push('candidate')
  if (mismatches.length > 0) throw new Error(`semantic Memory v3 holdout lock mismatch: ${mismatches.join(', ')}`)
  return lock
}

export async function runSemanticMemoryV3HoldoutEvaluation(input: {
  dataset: SemanticMemoryV3EvaluationDataset
  model: SemanticMemoryV3EvaluationDataset['manifest']['candidateIdentity']
  baseline: Pick<SemanticMemoryCandidateMetadata, 'id' | 'version' | 'parameters'>
  candidate: SemanticMemoryCandidate
  lock: unknown
  networkAttempts?: number
  fallbackMismatches?: number
}): Promise<SemanticMemoryEvaluationReport> {
  assertSemanticMemoryV3HoldoutLock({
    dataset: input.dataset,
    model: input.model,
    baseline: input.baseline,
    candidate: input.candidate.metadata,
    lock: input.lock
  })
  return runSemanticMemoryEvaluation({
    dataset: input.dataset,
    candidate: input.candidate,
    split: 'holdout',
    networkAttempts: input.networkAttempts,
    fallbackMismatches: input.fallbackMismatches
  })
}

function assertCandidateMatchesConfiguration(
  candidate: SemanticMemoryCandidateMetadata,
  configuration: SemanticMemoryV3GridConfiguration
): void {
  const expected: Record<string, number> = {
    minimumSimilarity: configuration.minimumSimilarity,
    semanticWeight: configuration.semanticWeight,
    lexicalWeight: configuration.lexicalWeight,
    rankConstant: configuration.rankConstant
  }
  if (candidate.parameters.fusionMode !== 'lexical-veto') expected.marginGap = configuration.marginGap
  const differences = Object.entries(expected).filter(([key, value]) => candidate.parameters[key] !== value)
  if (differences.length > 0) throw new Error(`candidate does not match v3 grid configuration ${configuration.id}`)
}

function gridConfigurationId(input: Omit<SemanticMemoryV3GridConfiguration, 'id'>): string {
  const part = (value: number) => String(value).replace('-', 'm').replace('.', 'p')
  return `v3-sim-${part(input.minimumSimilarity)}-gap-${part(input.marginGap)}-sem-${part(input.semanticWeight)}-lex-${part(input.lexicalWeight)}-rrf-${part(input.rankConstant)}`
}

function withoutTiming(metrics: SemanticMemoryEvaluationReport['metrics']): Omit<SemanticMemoryEvaluationReport['metrics'], 'latencyP50Ms' | 'latencyP95Ms'> {
  const { latencyP50Ms: _latencyP50Ms, latencyP95Ms: _latencyP95Ms, ...deterministic } = metrics
  return deterministic
}
