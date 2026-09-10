import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  runSemanticMemoryEvaluation,
  type SemanticMemoryCandidate,
  type SemanticMemoryCandidateMetadata,
  type SemanticMemoryEvaluationReport
} from './semantic-memory-evaluation.js'
import type {
  SemanticMemoryV2EvaluationDataset,
  SemanticMemoryV2EvaluationManifest
} from './semantic-memory-evaluation-v2-dataset.js'

const GridConfiguration = z.object({
  id: z.string().regex(/^sim-[a-z0-9-]+$/u),
  minimumSimilarity: z.number().min(-1).max(1),
  semanticWeight: z.number().positive(),
  lexicalWeight: z.number().positive(),
  rankConstant: z.number().int().positive()
}).strict()

const CandidateMetadata = z.object({
  id: z.string().min(1),
  kind: z.enum(['lexical', 'semantic', 'hybrid']),
  version: z.string().min(1),
  runtime: z.string().min(1),
  license: z.string().min(1),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  dimensions: z.number().int().positive().optional(),
  normalization: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  platforms: z.array(z.string().min(1))
}).strict()

export const SemanticMemoryV2EvaluationLockSchema = z.object({
  schemaVersion: z.literal(2),
  reportKind: z.literal('semantic-memory-evaluation-lock'),
  status: z.literal('locked'),
  lockedAt: z.string().datetime(),
  selectedOnSplit: z.literal('development'),
  dataset: z.object({
    id: z.string().min(1),
    recordsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    queriesSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict(),
  developmentGridSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  terminologySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  developmentEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  candidate: CandidateMetadata,
  selectedConfiguration: GridConfiguration,
  bootstrap: z.object({
    method: z.literal('paired-percentile'),
    seed: z.number().int().min(0).max(0xffffffff),
    resamples: z.number().int().positive(),
    confidenceLevel: z.number().gt(0).lt(1)
  }).strict(),
  gates: z.record(z.string(), z.union([z.number(), z.boolean()]))
}).strict()

export type SemanticMemoryV2GridConfiguration = z.infer<typeof GridConfiguration>
export type SemanticMemoryV2EvaluationLock = z.infer<typeof SemanticMemoryV2EvaluationLockSchema>
export type SemanticMemoryV2DevelopmentGridResult = {
  gridSha256: string
  entries: Array<{
    configuration: SemanticMemoryV2GridConfiguration
    report: SemanticMemoryEvaluationReport
  }>
}

export function semanticMemoryV2DevelopmentGridConfigurations(
  manifest: SemanticMemoryV2EvaluationManifest
): SemanticMemoryV2GridConfiguration[] {
  const configurations: SemanticMemoryV2GridConfiguration[] = []
  for (const minimumSimilarity of manifest.developmentGrid.minimumSimilarities) {
    for (const semanticWeight of manifest.developmentGrid.semanticWeights) {
      for (const lexicalWeight of manifest.developmentGrid.lexicalWeights) {
        for (const rankConstant of manifest.developmentGrid.rankConstants) {
          configurations.push(GridConfiguration.parse({
            id: gridConfigurationId({ minimumSimilarity, semanticWeight, lexicalWeight, rankConstant }),
            minimumSimilarity,
            semanticWeight,
            lexicalWeight,
            rankConstant
          }))
        }
      }
    }
  }
  if (new Set(configurations.map((configuration) => configuration.id)).size !== configurations.length) {
    throw new Error('semantic Memory development grid contains duplicate configurations')
  }
  return configurations
}

export function semanticMemoryV2DevelopmentGridSha256(
  manifest: SemanticMemoryV2EvaluationManifest
): string {
  return sha256(JSON.stringify(semanticMemoryV2DevelopmentGridConfigurations(manifest)))
}

export async function runSemanticMemoryV2DevelopmentGrid(input: {
  dataset: SemanticMemoryV2EvaluationDataset
  createCandidate: (
    configuration: SemanticMemoryV2GridConfiguration
  ) => SemanticMemoryCandidate | Promise<SemanticMemoryCandidate>
}): Promise<SemanticMemoryV2DevelopmentGridResult> {
  const configurations = semanticMemoryV2DevelopmentGridConfigurations(input.dataset.manifest)
  const entries = []
  for (const configuration of configurations) {
    const candidate = await input.createCandidate(configuration)
    assertCandidateMatchesConfiguration(candidate.metadata, configuration)
    const report = await runSemanticMemoryEvaluation({
      dataset: input.dataset,
      candidate,
      split: 'development'
    })
    if (report.results.some((result) => result.split !== 'development')) {
      throw new Error('semantic Memory development grid exposed a holdout result')
    }
    entries.push({ configuration, report })
  }
  return { gridSha256: semanticMemoryV2DevelopmentGridSha256(input.dataset.manifest), entries }
}

export function selectSemanticMemoryV2DevelopmentCandidate(input: {
  manifest: SemanticMemoryV2EvaluationManifest
  baseline: SemanticMemoryEvaluationReport
  grid: SemanticMemoryV2DevelopmentGridResult
}): SemanticMemoryV2DevelopmentGridResult['entries'][number] | undefined {
  const thresholds = input.manifest.thresholds
  const baselineLexicalControl = input.baseline.breakdowns.category['lexical-control']?.recallAtK ?? 0
  return [...input.grid.entries]
    .filter(({ report }) => {
      const lexicalControl = report.breakdowns.category['lexical-control']?.recallAtK ?? 0
      return report.safetyGatePassed &&
        report.metrics.abstentionAccuracy >= thresholds.emptyResultAccuracy &&
        input.baseline.metrics.precisionAtK - report.metrics.precisionAtK <= thresholds.maximumOverallPrecisionDecline &&
        baselineLexicalControl - lexicalControl <= thresholds.maximumLexicalControlRegression
    })
    .sort((left, right) =>
      right.report.metrics.recallAtK - left.report.metrics.recallAtK ||
      right.report.metrics.meanReciprocalRank - left.report.metrics.meanReciprocalRank ||
      right.report.metrics.precisionAtK - left.report.metrics.precisionAtK ||
      left.configuration.id.localeCompare(right.configuration.id)
    )[0]
}

export function createSemanticMemoryV2EvaluationLock(input: {
  dataset: SemanticMemoryV2EvaluationDataset
  candidate: SemanticMemoryCandidateMetadata
  selectedConfiguration: SemanticMemoryV2GridConfiguration
  terminologySha256: string
  developmentEvidenceSha256: string
  lockedAt: string
}): SemanticMemoryV2EvaluationLock {
  const configurations = semanticMemoryV2DevelopmentGridConfigurations(input.dataset.manifest)
  const selected = GridConfiguration.parse(input.selectedConfiguration)
  if (!configurations.some((configuration) => canonical(configuration) === canonical(selected))) {
    throw new Error('selected semantic Memory configuration is outside the frozen development grid')
  }
  assertCandidateMatchesConfiguration(input.candidate, selected)
  return SemanticMemoryV2EvaluationLockSchema.parse({
    schemaVersion: 2,
    reportKind: 'semantic-memory-evaluation-lock',
    status: 'locked',
    lockedAt: input.lockedAt,
    selectedOnSplit: 'development',
    dataset: {
      id: input.dataset.manifest.datasetId,
      recordsSha256: input.dataset.sourceHashes.records,
      queriesSha256: input.dataset.sourceHashes.queries,
      manifestSha256: input.dataset.sourceHashes.manifest
    },
    developmentGridSha256: semanticMemoryV2DevelopmentGridSha256(input.dataset.manifest),
    terminologySha256: input.terminologySha256,
    developmentEvidenceSha256: input.developmentEvidenceSha256,
    candidate: input.candidate,
    selectedConfiguration: selected,
    bootstrap: input.dataset.manifest.bootstrap,
    gates: input.dataset.manifest.thresholds
  })
}

export function assertSemanticMemoryV2HoldoutLock(input: {
  dataset: SemanticMemoryV2EvaluationDataset
  candidate: SemanticMemoryCandidateMetadata
  terminologySha256: string
  lock: unknown
}): SemanticMemoryV2EvaluationLock {
  const lock = SemanticMemoryV2EvaluationLockSchema.parse(input.lock)
  const expected = createSemanticMemoryV2EvaluationLock({
    dataset: input.dataset,
    candidate: input.candidate,
    selectedConfiguration: lock.selectedConfiguration,
    terminologySha256: input.terminologySha256,
    developmentEvidenceSha256: lock.developmentEvidenceSha256,
    lockedAt: lock.lockedAt
  })
  const fields = [
    'dataset',
    'developmentGridSha256',
    'terminologySha256',
    'candidate',
    'selectedConfiguration',
    'bootstrap',
    'gates'
  ] as const
  const differences = fields.filter((key) => canonical(lock[key]) !== canonical(expected[key]))
  if (differences.length > 0) {
    throw new Error(`semantic Memory v2 holdout lock mismatch: ${differences.join(', ')}`)
  }
  return lock
}

export async function runSemanticMemoryV2HoldoutEvaluation(input: {
  dataset: SemanticMemoryV2EvaluationDataset
  candidate: SemanticMemoryCandidate
  terminologySha256: string
  lock: unknown
  networkAttempts?: number
  fallbackMismatches?: number
}): Promise<SemanticMemoryEvaluationReport> {
  assertSemanticMemoryV2HoldoutLock({
    dataset: input.dataset,
    candidate: input.candidate.metadata,
    terminologySha256: input.terminologySha256,
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
  configuration: SemanticMemoryV2GridConfiguration
): void {
  const parameters = candidate.parameters
  const expected = {
    minimumSimilarity: configuration.minimumSimilarity,
    semanticWeight: configuration.semanticWeight,
    lexicalWeight: configuration.lexicalWeight,
    rankConstant: configuration.rankConstant
  }
  const differences = Object.entries(expected).filter(([key, value]) => parameters[key] !== value)
  if (differences.length > 0 || parameters.fusionMode !== 'semantic-gated-rrf') {
    throw new Error(`semantic Memory candidate does not match grid configuration ${configuration.id}`)
  }
}

function gridConfigurationId(input: Omit<SemanticMemoryV2GridConfiguration, 'id'>): string {
  const part = (value: number) => String(value).replace('-', 'm').replace('.', 'p')
  return `sim-${part(input.minimumSimilarity)}-sem-${part(input.semanticWeight)}-lex-${part(input.lexicalWeight)}-rrf-${part(input.rankConstant)}`
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
