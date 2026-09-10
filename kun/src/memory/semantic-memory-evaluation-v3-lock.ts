import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SemanticMemoryV3EvaluationManifest } from './semantic-memory-evaluation-v3-dataset.js'
import type { SemanticMemoryCandidateMetadata } from './semantic-memory-evaluation.js'

const Primitive = z.union([z.string(), z.number(), z.boolean()])

const HoldoutLock = z.object({
  schemaVersion: z.literal(1),
  lockKind: z.literal('semantic-memory-v3-holdout-lock'),
  dataset: z.object({
    id: z.string().min(1),
    recordsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    queriesSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    scoringVersion: z.literal(3),
    evaluationNow: z.string().datetime()
  }).strict(),
  model: z.object({
    modelId: z.string().min(1),
    modelSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    tokenizerSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    queryPrefix: z.string(),
    documentPrefix: z.string(),
    pooling: z.string().min(1),
    normalization: z.string().min(1),
    quantization: z.string().min(1),
    runtime: z.string().min(1),
    dimensions: z.number().int().positive()
  }).strict(),
  baseline: z.object({
    candidateId: z.string().min(1),
    version: z.string().min(1),
    parameters: z.record(z.string(), Primitive)
  }).strict(),
  candidate: z.object({
    candidateId: z.string().min(1),
    version: z.string().min(1),
    parameters: z.record(z.string(), Primitive)
  }).strict(),
  selection: z.object({
    developmentPassed: z.literal(true),
    configurationId: z.string().min(1),
    minimumSimilarity: z.number().min(-1).max(1),
    marginGap: z.number().min(0).max(1),
    semanticWeight: z.number().positive(),
    lexicalWeight: z.number().positive(),
    rankConstant: z.number().int().positive()
  }).strict(),
  gates: z.object({
    version: z.string().min(1),
    minimumRecallGainLowerBound: z.number().min(-1).max(1),
    minimumMrrGainLowerBound: z.number().min(-1).max(1),
    maximumOverallPrecisionDecline: z.number().min(0).max(1),
    maximumZeroOverlapRecallDecline: z.number().min(0).max(1),
    safety: z.object({
      scopeLeaks: z.literal(0),
      lifecycleLeaks: z.literal(0),
      authorityViolations: z.literal(0),
      networkAttempts: z.literal(0),
      fallbackMismatches: z.literal(0)
    }).strict()
  }).strict(),
  bootstrap: z.object({
    method: z.literal('paired-percentile'),
    seed: z.number().int().min(0).max(0xffffffff),
    resamples: z.number().int().positive(),
    confidenceLevel: z.number().gt(0).lt(1)
  }).strict(),
  hashes: z.object({
    dataset: z.string().regex(/^[a-f0-9]{64}$/u),
    model: z.string().regex(/^[a-f0-9]{64}$/u),
    baseline: z.string().regex(/^[a-f0-9]{64}$/u),
    candidate: z.string().regex(/^[a-f0-9]{64}$/u),
    gates: z.string().regex(/^[a-f0-9]{64}$/u),
    bootstrap: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict()
}).strict()

export type SemanticMemoryV3HoldoutLock = z.infer<typeof HoldoutLock>

export function createSemanticMemoryV3HoldoutLock(input: {
  manifest: SemanticMemoryV3EvaluationManifest
  manifestSha256: string
  model: SemanticMemoryV3EvaluationManifest['candidateIdentity']
  baseline: Pick<SemanticMemoryCandidateMetadata, 'id' | 'version' | 'parameters'>
  candidate: Pick<SemanticMemoryCandidateMetadata, 'id' | 'version' | 'parameters'>
  configuration: {
    id: string
    minimumSimilarity: number
    marginGap: number
    semanticWeight: number
    lexicalWeight: number
    rankConstant: number
  }
  gates: {
    version: string
    minimumRecallGainLowerBound: number
    minimumMrrGainLowerBound: number
    maximumOverallPrecisionDecline: number
    maximumZeroOverlapRecallDecline: number
    safety: {
      scopeLeaks: 0
      lifecycleLeaks: 0
      authorityViolations: 0
      networkAttempts: 0
      fallbackMismatches: 0
    }
  }
  developmentPassed: boolean
}): SemanticMemoryV3HoldoutLock {
  if (!input.developmentPassed) throw new Error('cannot create a holdout lock before development passes')
  const dataset = {
    id: input.manifest.datasetId,
    recordsSha256: input.manifest.hashes.recordsSha256,
    queriesSha256: input.manifest.hashes.queriesSha256,
    manifestSha256: input.manifestSha256,
    scoringVersion: input.manifest.scoringVersion,
    evaluationNow: input.manifest.evaluationNow
  } as const
  const model = input.model
  const baseline = {
    candidateId: input.baseline.id,
    version: input.baseline.version,
    parameters: input.baseline.parameters
  } as const
  const candidate = {
    candidateId: input.candidate.id,
    version: input.candidate.version,
    parameters: input.candidate.parameters
  } as const
  const { id: configurationId, ...configuration } = input.configuration
  const selection = { developmentPassed: true as const, configurationId, ...configuration }
  const bootstrap = input.manifest.bootstrap
  const lock = {
    schemaVersion: 1 as const,
    lockKind: 'semantic-memory-v3-holdout-lock' as const,
    dataset,
    model,
    baseline,
    candidate,
    selection,
    gates: input.gates,
    bootstrap,
    hashes: {
      dataset: hash(dataset),
      model: hash(model),
      baseline: hash(baseline),
      candidate: hash(candidate),
      gates: hash(input.gates),
      bootstrap: hash(bootstrap)
    }
  }
  return HoldoutLock.parse(lock)
}

export function parseSemanticMemoryV3HoldoutLock(value: unknown): SemanticMemoryV3HoldoutLock {
  const lock = HoldoutLock.parse(value)
  const expected = {
    dataset: hash(lock.dataset),
    model: hash(lock.model),
    baseline: hash(lock.baseline),
    candidate: hash(lock.candidate),
    gates: hash(lock.gates),
    bootstrap: hash(lock.bootstrap)
  }
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (lock.hashes[key] !== expected[key]) throw new Error(`holdout lock ${key} hash mismatch`)
  }
  return lock
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
