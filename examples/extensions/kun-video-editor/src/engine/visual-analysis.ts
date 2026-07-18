import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import type { SourceIdentity } from './schema.js'

const MAX_VISUAL_EMBEDDING_DIMENSIONS = 4_096
const MAX_VISUAL_FRAME_SAMPLES = 2_000
const MAX_VISUAL_VECTOR_VALUES = 500_000

export type VisualModelDescriptor = {
  adapterId: string
  adapterVersion: string
  modelId: string
  modelVersion: string
  packageId: string
  manifestSha256: string
  files: Array<{ name: string; sha256: string; byteSize: number }>
  embeddingDimensions: number
}

export type VisualModelInstallReceipt = {
  broker: 'kun-model-broker'
  /** Absent legacy receipts are treated as downloaded packages. */
  packageSource?: 'bundled' | 'downloaded'
  packageId: string
  modelId: string
  modelVersion: string
  manifestSha256: string
  files: Array<{ name: string; sha256: string; byteSize: number }>
  downloadVerified: boolean
  sourceVerified?: boolean
  installVerified: boolean
  signatureVerified: boolean
  installedAt: string
}

export type VisualAdapterCapability =
  | {
      outcome: 'ready'
      adapter: {
        id: string
        version: string
        modelId: string
        modelVersion: string
        packageId: string
        manifestSha256: string
        embeddingDimensions: number
        execution: 'local'
      }
      installation: VisualModelInstallReceipt
      networkUsedForInference: false
    }
  | {
      outcome: 'unavailable'
      code: 'visual_model_disabled' | 'visual_model_missing' | 'visual_model_unverified' | 'visual_inference_broker_unavailable'
      retryable: boolean
      remediation: string
      networkUsedForInference: false
      verificationErrors: string[]
    }

export type FrameSample = {
  id: string
  assetId: string
  startUs: number
  endUs: number
  representativeUs: number
}

export type FrameSamplingPlan = {
  schemaVersion: 1
  assetId: string
  sourceFingerprint: SourceIdentity
  durationUs: number
  intervalUs: number
  maxFrames: number
  strategy: 'uniform-interval-v1'
  samples: FrameSample[]
  completeness: 'complete' | 'bounded'
  omittedSampleCount: number
}

export type VisualEmbeddingEvidence = {
  sampleId: string
  vector: number[]
  confidence?: number
}

export type VisualIndexRecord = {
  schemaVersion: 1
  id: string
  assetId: string
  sourceFingerprint: SourceIdentity
  adapter: {
    id: string
    version: string
    modelId: string
    modelVersion: string
    packageId: string
    manifestSha256: string
    embeddingDimensions: number
    execution: 'local'
  }
  parameters: {
    durationUs: number
    intervalUs: number
    maxFrames: number
    samplingStrategy: FrameSamplingPlan['strategy']
    samplingPlanKey: string
    embeddingDimensions: number
  }
  samples: Array<FrameSample & { vector: number[]; confidence?: number }>
  completeness: 'complete' | 'partial'
  indexedSampleCount: number
  plannedSampleCount: number
  omittedSampleCount: number
  createdAt: string
  immutable: true
}

export type VisualMoment = {
  id: string
  assetId: string
  sourceRange: { assetId: string; startUs: number; endUs: number }
  evidenceKind: 'visual-embedding'
  score: number
  scoreSemantics: 'uncalibrated-cosine'
  indexId: string
  indexCompleteness: VisualIndexRecord['completeness']
  sampleId: string
  evidence: {
    representativeUs: number
    modelConfidence?: number
  }
}

export type VisualMomentPage = {
  schemaVersion: 1
  offset: number
  results: VisualMoment[]
  nextOffset?: number
  totalMatches: number
  completeness: VisualIndexRecord['completeness']
  ranking: {
    semantics: 'uncalibrated-cosine'
    calibratedConfidence: false
    local: true
    networkUsed: false
    adapterId: string
    adapterVersion: string
    modelId: string
    modelVersion: string
    packageId: string
    manifestSha256: string
  }
}

export type VisualIndexProgress = {
  generation: number
  status: 'queued' | 'running' | 'cancelled' | 'ready' | 'failed'
  completed: number
  total: number
  unit: 'frames'
  message?: string
  error?: { code: string; message: string; retryable: boolean }
}

export function verifyVisualModelInstallation(
  descriptor: VisualModelDescriptor,
  receipt: VisualModelInstallReceipt
): { valid: boolean; errors: string[] } {
  validateDescriptor(descriptor)
  const errors: string[] = []
  const receiptNames = new Set<string>()
  if (receipt.files.length < 1 || receipt.files.length > 128) {
    errors.push('Installation receipt must contain 1 through 128 files.')
  }
  for (const file of receipt.files.slice(0, 128)) {
    if (!isSafeBasename(file.name) || receiptNames.has(file.name)) {
      errors.push('Installation receipt file names must be unique safe basenames.')
    }
    receiptNames.add(file.name)
    if (!isSha256(file.sha256) || !Number.isSafeInteger(file.byteSize) || file.byteSize < 1) {
      errors.push(`Installed model file failed manifest validation: ${safeDiagnosticName(file.name)}`)
    }
  }
  if (receipt.broker !== 'kun-model-broker') errors.push('Installation was not attested by the Kun model broker.')
  if (receipt.packageId !== descriptor.packageId) errors.push('Installed package ID does not match the adapter descriptor.')
  if (receipt.modelId !== descriptor.modelId || receipt.modelVersion !== descriptor.modelVersion) {
    errors.push('Installed model identity does not match the adapter descriptor.')
  }
  if (receipt.manifestSha256 !== descriptor.manifestSha256) errors.push('Installed manifest digest does not match.')
  const packageSource = receipt.packageSource ?? 'downloaded'
  if (!['bundled', 'downloaded'].includes(packageSource)) {
    errors.push('Model package source is invalid.')
  } else if (packageSource === 'downloaded' && !receipt.downloadVerified) {
    errors.push('Model download has not been verified.')
  } else if (packageSource === 'bundled' && receipt.downloadVerified) {
    errors.push('Bundled model package falsely claims a verified download.')
  }
  if (packageSource === 'bundled' && receipt.sourceVerified !== true) {
    errors.push('Bundled model package source has not been verified.')
  }
  if (!receipt.installVerified) errors.push('Model installation has not been verified.')
  if (!receipt.signatureVerified) errors.push('Model package signature has not been verified.')
  if (!isIsoDate(receipt.installedAt)) errors.push('Installation receipt timestamp is invalid.')
  const installed = new Map(receipt.files.map((file) => [file.name, file]))
  for (const expected of descriptor.files) {
    const actual = installed.get(expected.name)
    if (!actual) errors.push(`Required model file is missing: ${expected.name}`)
    else if (actual.sha256 !== expected.sha256 || actual.byteSize !== expected.byteSize) {
      errors.push(`Required model file failed digest or size verification: ${expected.name}`)
    }
  }
  if (receipt.files.some((file) => !descriptor.files.some(({ name }) => name === file.name))) {
    errors.push('Installation receipt contains files outside the declared model manifest.')
  }
  return { valid: errors.length === 0, errors: errors.slice(0, 32) }
}

export function negotiateVisualAdapter(input: {
  optIn: boolean
  descriptor: VisualModelDescriptor
  receipt?: VisualModelInstallReceipt
  inferenceBrokerAvailable: boolean
}): VisualAdapterCapability {
  validateDescriptor(input.descriptor)
  if (!input.optIn) {
    return unavailable(
      'visual_model_disabled',
      true,
      'Enable local visual indexing for this workspace before installing or running a model.'
    )
  }
  if (!input.receipt) {
    return unavailable(
      'visual_model_missing',
      true,
      'Install the declared local visual model through a Host model broker that returns a verified receipt.'
    )
  }
  const verification = verifyVisualModelInstallation(input.descriptor, input.receipt)
  if (!verification.valid) {
    return unavailable(
      'visual_model_unverified',
      true,
      'Repair or reinstall the model through the Host model broker; unverified model files will not execute.',
      verification.errors
    )
  }
  if (!input.inferenceBrokerAvailable) {
    return unavailable(
      'visual_inference_broker_unavailable',
      false,
      'The model is verified, but this Extension API has no approved local visual-inference broker. Filename and transcript search remain available.'
    )
  }
  return {
    outcome: 'ready',
    adapter: {
      id: input.descriptor.adapterId,
      version: input.descriptor.adapterVersion,
      modelId: input.descriptor.modelId,
      modelVersion: input.descriptor.modelVersion,
      packageId: input.descriptor.packageId,
      manifestSha256: input.descriptor.manifestSha256,
      embeddingDimensions: input.descriptor.embeddingDimensions,
      execution: 'local'
    },
    installation: deepFreeze(structuredClone(input.receipt)),
    networkUsedForInference: false
  }
}

export function buildFrameSamplingPlan(input: {
  assetId: string
  durationUs: number
  sourceFingerprint: SourceIdentity
  intervalUs?: number
  maxFrames?: number
}): FrameSamplingPlan {
  identifier(input.assetId, 'assetId')
  const durationUs = boundedInteger(input.durationUs, 1, Number.MAX_SAFE_INTEGER, 'durationUs')
  const intervalUs = boundedInteger(input.intervalUs ?? 2_000_000, 100_000, 60_000_000, 'intervalUs')
  const maxFrames = boundedInteger(input.maxFrames ?? 240, 1, MAX_VISUAL_FRAME_SAMPLES, 'maxFrames')
  assertFingerprint(input.sourceFingerprint)
  const total = Math.max(1, Math.ceil(durationUs / intervalUs))
  const sampleCount = Math.min(total, maxFrames)
  const samples: FrameSample[] = []
  const sampleIndexes = uniformlyDistributedIndexes(total, sampleCount)
  for (const sampleIndex of sampleIndexes) {
    const startUs = Math.min(durationUs - 1, sampleIndex * intervalUs)
    const endUs = Math.min(durationUs, startUs + intervalUs)
    samples.push({
      id: `frame:${input.assetId}:${sampleIndex}`,
      assetId: input.assetId,
      startUs,
      endUs,
      representativeUs: startUs + Math.floor((endUs - startUs) / 2)
    })
  }
  return deepFreeze({
    schemaVersion: 1,
    assetId: input.assetId,
    sourceFingerprint: { ...input.sourceFingerprint },
    durationUs,
    intervalUs,
    maxFrames,
    strategy: 'uniform-interval-v1',
    samples,
    completeness: total <= maxFrames ? 'complete' : 'bounded',
    omittedSampleCount: Math.max(0, total - sampleCount)
  })
}

/**
 * Finalizes evidence returned by an approved adapter. This function never
 * synthesizes vectors; every indexed sample must have adapter evidence.
 */
export function createVisualIndexRecord(input: {
  capability: Extract<VisualAdapterCapability, { outcome: 'ready' }>
  plan: FrameSamplingPlan
  embeddings: readonly VisualEmbeddingEvidence[]
  allowPartial?: boolean
  now?: () => Date
}): VisualIndexRecord {
  assertFrameSamplingPlan(input.plan)
  const dimensions = inferDimensions(input.embeddings)
  if (dimensions !== input.capability.adapter.embeddingDimensions) {
    throw engineError('invalid_operation', 'Visual evidence dimensions do not match the verified model descriptor')
  }
  if (input.plan.samples.length * dimensions > MAX_VISUAL_VECTOR_VALUES) {
    throw engineError(
      'invalid_operation',
      `Visual index exceeds the ${MAX_VISUAL_VECTOR_VALUES} value storage budget; increase intervalUs or reduce maxFrames`
    )
  }
  const byId = new Map(input.embeddings.map((entry) => [entry.sampleId, entry]))
  if (byId.size !== input.embeddings.length) throw engineError('invalid_operation', 'Visual evidence sample IDs must be unique')
  if (!input.allowPartial && byId.size !== input.plan.samples.length) {
    throw engineError('invalid_operation', 'A complete visual index requires evidence for every planned sample')
  }
  const samples = input.plan.samples.flatMap((sample) => {
    const evidence = byId.get(sample.id)
    if (!evidence) return []
    if (evidence.vector.length !== dimensions) throw engineError('invalid_operation', 'Visual embedding dimensions are inconsistent')
    const vector = normalizedVector(evidence.vector, 'visual embedding')
    if (evidence.confidence !== undefined) confidence(evidence.confidence, 'visual confidence')
    return [{
      ...sample,
      vector,
      ...(evidence.confidence === undefined ? {} : { confidence: evidence.confidence })
    }]
  })
  if (samples.length === 0) throw engineError('invalid_operation', 'Visual index requires at least one measured embedding')
  for (const evidence of input.embeddings) {
    if (!input.plan.samples.some(({ id }) => id === evidence.sampleId)) {
      throw engineError('invalid_operation', `Visual evidence references an unplanned sample: ${evidence.sampleId}`)
    }
  }
  const key = visualIndexKey(input.plan, input.capability.adapter, dimensions, samples)
  return deepFreeze({
    schemaVersion: 1,
    id: `visual-index:${key}`,
    assetId: input.plan.assetId,
    sourceFingerprint: { ...input.plan.sourceFingerprint },
    adapter: { ...input.capability.adapter },
    parameters: {
      durationUs: input.plan.durationUs,
      intervalUs: input.plan.intervalUs,
      maxFrames: input.plan.maxFrames,
      samplingStrategy: input.plan.strategy,
      samplingPlanKey: samplingPlanKey(input.plan),
      embeddingDimensions: dimensions
    },
    samples,
    completeness: input.plan.completeness === 'complete' && samples.length === input.plan.samples.length
      ? 'complete'
      : 'partial',
    indexedSampleCount: samples.length,
    plannedSampleCount: input.plan.samples.length,
    omittedSampleCount: input.plan.omittedSampleCount,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    immutable: true
  })
}

export function searchVisualMoments(input: {
  index: VisualIndexRecord
  queryVector: readonly number[]
  minimumScore?: number
  offset?: number
  pageSize?: number
}): VisualMomentPage {
  assertVisualIndex(input.index)
  const query = normalizedVector(input.queryVector, 'visual query')
  if (query.length !== input.index.parameters.embeddingDimensions) {
    throw engineError('invalid_operation', 'Visual query dimensions do not match the immutable index')
  }
  const minimumScore = finite(input.minimumScore ?? -1, -1, 1, 'minimumScore')
  const offset = boundedInteger(input.offset ?? 0, 0, 1_000_000, 'offset')
  const pageSize = boundedInteger(input.pageSize ?? 20, 1, 100, 'pageSize')
  const matches = input.index.samples
    .map((sample): VisualMoment => ({
      id: `moment:${input.index.id}:${sample.id}`.slice(0, 512),
      assetId: input.index.assetId,
      sourceRange: { assetId: input.index.assetId, startUs: sample.startUs, endUs: sample.endUs },
      evidenceKind: 'visual-embedding',
      score: Number(dot(query, normalizedVector(sample.vector, 'visual index sample')).toFixed(8)),
      scoreSemantics: 'uncalibrated-cosine',
      indexId: input.index.id,
      indexCompleteness: input.index.completeness,
      sampleId: sample.id,
      evidence: {
        representativeUs: sample.representativeUs,
        ...(sample.confidence === undefined ? {} : { modelConfidence: sample.confidence })
      }
    }))
    .filter(({ score }) => score >= minimumScore)
    .sort((left, right) => right.score - left.score || left.sourceRange.startUs - right.sourceRange.startUs)
  const results = matches.slice(offset, offset + pageSize)
  const nextOffset = offset + results.length
  return {
    schemaVersion: 1,
    offset,
    results,
    ...(nextOffset < matches.length ? { nextOffset } : {}),
    totalMatches: matches.length,
    completeness: input.index.completeness,
    ranking: {
      semantics: 'uncalibrated-cosine',
      calibratedConfidence: false,
      local: true,
      networkUsed: false,
      adapterId: input.index.adapter.id,
      adapterVersion: input.index.adapter.version,
      modelId: input.index.adapter.modelId,
      modelVersion: input.index.adapter.modelVersion,
      packageId: input.index.adapter.packageId,
      manifestSha256: input.index.adapter.manifestSha256
    }
  }
}

export function isValidVisualIndexRecord(value: unknown): value is VisualIndexRecord {
  if (!isObjectRecord(value)) return false
  try {
    assertVisualIndex(value as VisualIndexRecord)
    return true
  } catch {
    return false
  }
}

export class VisualIndexProgressTracker {
  private value: VisualIndexProgress

  constructor(total: number) {
    this.value = {
      generation: 1,
      status: 'queued',
      completed: 0,
      total: boundedInteger(total, 1, 10_000, 'total'),
      unit: 'frames'
    }
  }

  snapshot(): VisualIndexProgress {
    return structuredClone(this.value)
  }

  start(message?: string): VisualIndexProgress {
    this.assertActive()
    this.value = this.next({ status: 'running', ...(message ? { message } : {}) })
    return this.snapshot()
  }

  report(completed: number, message?: string): VisualIndexProgress {
    this.assertActive()
    const bounded = boundedInteger(completed, this.value.completed, this.value.total, 'completed')
    this.value = this.next({ status: 'running', completed: bounded, ...(message ? { message } : {}) })
    return this.snapshot()
  }

  cancel(): VisualIndexProgress {
    this.assertActive()
    this.value = this.next({ status: 'cancelled', message: 'Visual indexing was cancelled; no incomplete index was published.' })
    return this.snapshot()
  }

  complete(): VisualIndexProgress {
    this.assertActive()
    this.value = this.next({ status: 'ready', completed: this.value.total })
    return this.snapshot()
  }

  fail(code: string, message: string, retryable = true): VisualIndexProgress {
    this.assertActive()
    identifier(code, 'error code')
    this.value = this.next({ status: 'failed', error: { code, message: message.slice(0, 1_024), retryable } })
    return this.snapshot()
  }

  private next(patch: Partial<VisualIndexProgress>): VisualIndexProgress {
    return { ...this.value, ...patch, generation: this.value.generation + 1 }
  }

  private assertActive(): void {
    if (['cancelled', 'ready', 'failed'].includes(this.value.status)) {
      throw engineError('invalid_operation', `Visual index progress is already terminal: ${this.value.status}`)
    }
  }
}

function unavailable(
  code: Extract<VisualAdapterCapability, { outcome: 'unavailable' }>['code'],
  retryable: boolean,
  remediation: string,
  verificationErrors: string[] = []
): Extract<VisualAdapterCapability, { outcome: 'unavailable' }> {
  return {
    outcome: 'unavailable',
    code,
    retryable,
    remediation,
    networkUsedForInference: false,
    verificationErrors: verificationErrors.slice(0, 32)
  }
}

function validateDescriptor(value: VisualModelDescriptor): void {
  identifier(value.adapterId, 'adapterId')
  identifier(value.modelId, 'modelId')
  identifier(value.packageId, 'packageId')
  version(value.adapterVersion, 'adapterVersion')
  version(value.modelVersion, 'modelVersion')
  sha256(value.manifestSha256, 'manifestSha256')
  boundedInteger(value.embeddingDimensions, 1, MAX_VISUAL_EMBEDDING_DIMENSIONS, 'embeddingDimensions')
  if (value.files.length < 1 || value.files.length > 128) throw engineError('invalid_operation', 'Visual model manifest requires 1 through 128 files')
  const names = new Set<string>()
  for (const file of value.files) {
    if (!isSafeBasename(file.name) || names.has(file.name)) {
      throw engineError('invalid_operation', 'Visual model file names must be unique safe basenames')
    }
    names.add(file.name)
    sha256(file.sha256, `digest for ${file.name}`)
    boundedInteger(file.byteSize, 1, Number.MAX_SAFE_INTEGER, `byte size for ${file.name}`)
  }
}

function uniformlyDistributedIndexes(total: number, sampleCount: number): number[] {
  if (sampleCount === total) return Array.from({ length: total }, (_, index) => index)
  if (sampleCount === 1) return [Math.floor((total - 1) / 2)]
  return Array.from({ length: sampleCount }, (_, index) =>
    Math.floor(index * (total - 1) / (sampleCount - 1))
  )
}

function samplingPlanKey(plan: FrameSamplingPlan): string {
  return stableKey([
    plan.assetId,
    plan.sourceFingerprint.value,
    plan.durationUs,
    plan.intervalUs,
    plan.maxFrames,
    plan.strategy,
    ...plan.samples.flatMap((sample) => [
      sample.id,
      sample.startUs,
      sample.endUs,
      sample.representativeUs
    ])
  ])
}

function visualIndexKey(
  plan: FrameSamplingPlan,
  adapter: VisualIndexRecord['adapter'],
  dimensions: number,
  samples: readonly VisualIndexRecord['samples'][number][]
): string {
  return stableKey([
    plan.assetId,
    plan.sourceFingerprint.value,
    adapter.id,
    adapter.version,
    adapter.modelId,
    adapter.modelVersion,
    adapter.packageId,
    adapter.manifestSha256,
    plan.durationUs,
    plan.intervalUs,
    plan.maxFrames,
    plan.strategy,
    samplingPlanKey(plan),
    dimensions,
    ...samples.flatMap((sample) => [
      sample.id,
      ...sample.vector.map((value) => Number(value.toPrecision(15))),
      sample.confidence ?? 'no-confidence'
    ])
  ])
}

function assertFrameSamplingPlan(plan: FrameSamplingPlan): void {
  if (!isObjectRecord(plan) || plan.schemaVersion !== 1 || !Array.isArray(plan.samples)) {
    throw engineError('invalid_operation', 'Visual frame sampling plan is invalid')
  }
  const canonical = buildFrameSamplingPlan({
    assetId: plan.assetId,
    durationUs: plan.durationUs,
    sourceFingerprint: plan.sourceFingerprint,
    intervalUs: plan.intervalUs,
    maxFrames: plan.maxFrames
  })
  if (
    plan.strategy !== canonical.strategy ||
    plan.completeness !== canonical.completeness ||
    plan.omittedSampleCount !== canonical.omittedSampleCount ||
    plan.samples.length !== canonical.samples.length ||
    plan.samples.some((sample, index) => {
      const expected = canonical.samples[index]
      return !expected || sample.id !== expected.id || sample.assetId !== expected.assetId ||
        sample.startUs !== expected.startUs || sample.endUs !== expected.endUs ||
        sample.representativeUs !== expected.representativeUs
    })
  ) {
    throw engineError('invalid_operation', 'Visual frame sampling plan does not match deterministic sampling parameters')
  }
}

function assertVisualIndex(index: VisualIndexRecord): void {
  if (
    index.schemaVersion !== 1 || index.immutable !== true ||
    !isObjectRecord(index.adapter) || !isObjectRecord(index.parameters) ||
    !Array.isArray(index.samples)
  ) {
    throw engineError('invalid_operation', 'Visual index record shape is invalid')
  }
  identifier(index.id, 'visual index ID')
  if (!/^visual-index:[a-f0-9]{64}$/u.test(index.id)) {
    throw engineError('invalid_operation', 'Visual index ID is not content-addressed')
  }
  identifier(index.assetId, 'visual index asset ID')
  assertFingerprint(index.sourceFingerprint)
  identifier(index.adapter.id, 'visual adapter ID')
  version(index.adapter.version, 'visual adapter version')
  identifier(index.adapter.modelId, 'visual model ID')
  version(index.adapter.modelVersion, 'visual model version')
  identifier(index.adapter.packageId, 'visual model package ID')
  sha256(index.adapter.manifestSha256, 'visual model manifest digest')
  if (index.adapter.execution !== 'local') {
    throw engineError('invalid_operation', 'Visual index adapter execution must be local')
  }
  const dimensions = boundedInteger(
    index.parameters.embeddingDimensions,
    1,
    MAX_VISUAL_EMBEDDING_DIMENSIONS,
    'visual index embedding dimensions'
  )
  if (index.adapter.embeddingDimensions !== dimensions) {
    throw engineError('invalid_operation', 'Visual index adapter dimensions do not match its parameters')
  }
  const plan = buildFrameSamplingPlan({
    assetId: index.assetId,
    durationUs: index.parameters.durationUs,
    sourceFingerprint: index.sourceFingerprint,
    intervalUs: index.parameters.intervalUs,
    maxFrames: index.parameters.maxFrames
  })
  if (
    index.parameters.samplingStrategy !== plan.strategy ||
    index.parameters.samplingPlanKey !== samplingPlanKey(plan) ||
    index.plannedSampleCount !== plan.samples.length ||
    index.omittedSampleCount !== plan.omittedSampleCount
  ) {
    throw engineError('invalid_operation', 'Visual index sampling provenance does not match its deterministic plan')
  }
  if (index.samples.length < 1 || index.samples.length > MAX_VISUAL_FRAME_SAMPLES) {
    throw engineError('invalid_operation', 'Visual index sample count is out of bounds')
  }
  if (
    index.samples.length * dimensions > MAX_VISUAL_VECTOR_VALUES ||
    index.indexedSampleCount !== index.samples.length ||
    index.indexedSampleCount > index.plannedSampleCount ||
    !['complete', 'partial'].includes(index.completeness) ||
    (index.completeness === 'complete' && (
      plan.completeness !== 'complete' || index.indexedSampleCount !== index.plannedSampleCount
    )) ||
    !isIsoDate(index.createdAt)
  ) {
    throw engineError('invalid_operation', 'Visual index completeness or storage bounds are invalid')
  }
  const plannedById = new Map(plan.samples.map((sample, position) => [sample.id, { sample, position }]))
  const sampleIds = new Set<string>()
  let previousPosition = -1
  for (const sample of index.samples) {
    identifier(sample.id, 'visual sample ID')
    if (sample.assetId !== index.assetId || sampleIds.has(sample.id)) {
      throw engineError('invalid_operation', 'Visual index samples must have unique IDs bound to one asset')
    }
    sampleIds.add(sample.id)
    const planned = plannedById.get(sample.id)
    if (
      !planned || planned.position <= previousPosition ||
      sample.startUs !== planned.sample.startUs || sample.endUs !== planned.sample.endUs ||
      sample.representativeUs !== planned.sample.representativeUs
    ) {
      throw engineError('invalid_operation', 'Visual index sample is not bound to the deterministic frame plan')
    }
    previousPosition = planned.position
    if (sample.vector.length !== dimensions) {
      throw engineError('invalid_operation', 'Visual index sample dimensions are inconsistent')
    }
    normalizedVector(sample.vector, 'visual index sample')
    if (sample.confidence !== undefined) confidence(sample.confidence, 'visual sample confidence')
  }
  const expectedId = `visual-index:${visualIndexKey(plan, index.adapter, dimensions, index.samples)}`
  if (index.id !== expectedId) {
    throw engineError('invalid_operation', 'Visual index content digest does not match its immutable evidence')
  }
}

function inferDimensions(values: readonly VisualEmbeddingEvidence[]): number {
  const dimensions = values[0]?.vector.length ?? 0
  if (dimensions < 1 || dimensions > MAX_VISUAL_EMBEDDING_DIMENSIONS) throw engineError('invalid_operation', 'Visual embeddings have invalid dimensions')
  return dimensions
}

function normalizedVector(values: readonly number[], name: string): number[] {
  if (values.length < 1 || values.length > MAX_VISUAL_EMBEDDING_DIMENSIONS) throw engineError('invalid_operation', `${name} has invalid dimensions`)
  let magnitudeSquared = 0
  for (const value of values) {
    if (!Number.isFinite(value)) throw engineError('invalid_operation', `${name} must contain finite numbers`)
    magnitudeSquared += value * value
  }
  if (magnitudeSquared <= Number.EPSILON) throw engineError('invalid_operation', `${name} cannot be a zero vector`)
  const magnitude = Math.sqrt(magnitudeSquared)
  return values.map((value) => value / magnitude)
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * right[index]!, 0)
}

function assertFingerprint(value: SourceIdentity): void {
  if (value.algorithm !== 'sha256') throw engineError('invalid_operation', 'Visual source fingerprint must use SHA-256')
  sha256(value.value, 'source fingerprint')
}

function stableKey(values: readonly (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex')
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function sha256(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw engineError('invalid_operation', `${name} must be a lowercase SHA-256 digest`)
}

function identifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) throw engineError('invalid_operation', `${name} is invalid`)
}

function boundedString(value: string, name: string, minimum: number, maximum: number): void {
  if (value.length < minimum || value.length > maximum) throw engineError('invalid_operation', `${name} is out of bounds`)
}

function version(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(value)) {
    throw engineError('invalid_operation', `${name} must be a bounded printable version`)
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function finite(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${name} must be from ${minimum} through ${maximum}`)
  }
  return value
}

function confidence(value: number, name: string): void {
  finite(value, 0, 1, name)
}

function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function isSafeBasename(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) && value !== '.' && value !== '..'
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value)
}

function safeDiagnosticName(value: string): string {
  return isSafeBasename(value) ? value : '<invalid-name>'
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
