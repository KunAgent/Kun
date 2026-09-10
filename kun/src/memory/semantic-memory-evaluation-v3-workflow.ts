import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  runSemanticMemoryEvaluation,
  type SemanticMemoryCandidate,
  type SemanticMemoryCandidateMetadata,
  type SemanticMemoryEvaluationReport
} from './semantic-memory-evaluation.js'
import type { SemanticMemoryV3EvaluationDataset } from './semantic-memory-evaluation-v3-dataset.js'
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
  const expected = {
    minimumSimilarity: configuration.minimumSimilarity,
    marginGap: configuration.marginGap,
    semanticWeight: configuration.semanticWeight,
    lexicalWeight: configuration.lexicalWeight,
    rankConstant: configuration.rankConstant
  }
  const differences = Object.entries(expected).filter(([key, value]) => candidate.parameters[key] !== value)
  if (differences.length > 0) throw new Error(`candidate does not match v3 grid configuration ${configuration.id}`)
}

function gridConfigurationId(input: Omit<SemanticMemoryV3GridConfiguration, 'id'>): string {
  const part = (value: number) => String(value).replace('-', 'm').replace('.', 'p')
  return `v3-sim-${part(input.minimumSimilarity)}-gap-${part(input.marginGap)}-sem-${part(input.semanticWeight)}-lex-${part(input.lexicalWeight)}-rrf-${part(input.rankConstant)}`
}
