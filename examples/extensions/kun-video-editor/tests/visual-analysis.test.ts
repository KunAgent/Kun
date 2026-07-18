import { describe, expect, it } from 'vitest'
import {
  VisualIndexProgressTracker,
  buildFrameSamplingPlan,
  createVisualIndexRecord,
  isValidVisualIndexRecord,
  negotiateVisualAdapter,
  readMediaIntelligenceEvidence,
  searchVisualMoments,
  verifyVisualModelInstallation,
  type VisualModelDescriptor,
  type VisualModelInstallReceipt
} from '../src/engine/index.js'

const descriptor: VisualModelDescriptor = {
  adapterId: 'kun.local.clip-fixture',
  adapterVersion: '1.0.0',
  modelId: 'clip-fixture',
  modelVersion: '1.0.0',
  packageId: 'kun-model.clip-fixture',
  manifestSha256: 'a'.repeat(64),
  files: [{ name: 'model.bin', sha256: 'b'.repeat(64), byteSize: 1_024 }],
  embeddingDimensions: 3
}

const receipt: VisualModelInstallReceipt = {
  broker: 'kun-model-broker',
  packageId: descriptor.packageId,
  modelId: descriptor.modelId,
  modelVersion: descriptor.modelVersion,
  manifestSha256: descriptor.manifestSha256,
  files: descriptor.files,
  downloadVerified: true,
  installVerified: true,
  signatureVerified: true,
  installedAt: '2026-01-01T00:00:00.000Z'
}

describe('negotiated local visual intelligence', () => {
  it('requires verified installation and an approved inference broker without fabricating fallback results', () => {
    expect(negotiateVisualAdapter({
      optIn: false, descriptor, receipt, inferenceBrokerAvailable: true
    })).toMatchObject({ outcome: 'unavailable', code: 'visual_model_disabled', networkUsedForInference: false })
    expect(negotiateVisualAdapter({
      optIn: true, descriptor, inferenceBrokerAvailable: true
    })).toMatchObject({ outcome: 'unavailable', code: 'visual_model_missing', networkUsedForInference: false })
    const invalid = { ...receipt, files: [{ ...receipt.files[0]!, sha256: 'c'.repeat(64) }] }
    expect(verifyVisualModelInstallation(descriptor, invalid)).toMatchObject({ valid: false })
    expect(negotiateVisualAdapter({
      optIn: true, descriptor, receipt: invalid, inferenceBrokerAvailable: true
    })).toMatchObject({ outcome: 'unavailable', code: 'visual_model_unverified' })
    const unbrokered = negotiateVisualAdapter({
      optIn: true, descriptor, receipt, inferenceBrokerAvailable: false
    })
    expect(unbrokered).toMatchObject({
      outcome: 'unavailable', code: 'visual_inference_broker_unavailable', networkUsedForInference: false
    })
    expect(unbrokered).not.toHaveProperty('index')
    expect(JSON.stringify(unbrokered)).not.toMatch(/\/(?:Users|tmp|private)\//u)

    const unsafeReceipt = {
      ...receipt,
      files: [
        ...receipt.files,
        { name: '../escape.bin', sha256: 'd'.repeat(64), byteSize: 8 }
      ]
    }
    expect(verifyVisualModelInstallation(descriptor, unsafeReceipt)).toMatchObject({ valid: false })
    expect(verifyVisualModelInstallation(descriptor, {
      ...receipt,
      signatureVerified: false
    })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Model package signature has not been verified.'])
    })
    expect(verifyVisualModelInstallation(descriptor, {
      ...receipt,
      packageSource: 'bundled',
      downloadVerified: false,
      sourceVerified: true
    })).toEqual({ valid: true, errors: [] })
    expect(verifyVisualModelInstallation(descriptor, {
      ...receipt,
      packageSource: 'bundled',
      downloadVerified: true,
      sourceVerified: true
    })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Bundled model package falsely claims a verified download.'])
    })
    expect(() => negotiateVisualAdapter({
      optIn: true,
      descriptor: { ...descriptor, files: [{ ...descriptor.files[0]!, name: '/private/model.bin' }] },
      receipt,
      inferenceBrokerAvailable: true
    })).toThrowError(/safe basenames/u)
  })

  it('builds bounded immutable frame indexes and pages uncalibrated moment matches', () => {
    const capability = negotiateVisualAdapter({
      optIn: true, descriptor, receipt, inferenceBrokerAvailable: true
    })
    expect(capability.outcome).toBe('ready')
    if (capability.outcome !== 'ready') throw new Error('expected verified fixture adapter')
    const plan = buildFrameSamplingPlan({
      assetId: 'asset-visual',
      durationUs: 10_000_000,
      sourceFingerprint: { algorithm: 'sha256', value: 'd'.repeat(64) },
      intervalUs: 2_000_000,
      maxFrames: 3
    })
    expect(plan).toMatchObject({
      completeness: 'bounded',
      omittedSampleCount: 2,
      durationUs: 10_000_000,
      maxFrames: 3,
      strategy: 'uniform-interval-v1'
    })
    expect(plan.samples.map(({ representativeUs }) => representativeUs)).toEqual([
      1_000_000,
      5_000_000,
      9_000_000
    ])
    const index = createVisualIndexRecord({
      capability,
      plan,
      embeddings: [
        { sampleId: plan.samples[0]!.id, vector: [1, 0, 0], confidence: 0.9 },
        { sampleId: plan.samples[1]!.id, vector: [0.8, 0.2, 0] },
        { sampleId: plan.samples[2]!.id, vector: [0, 1, 0] }
      ],
      now: () => new Date('2026-01-02T00:00:00.000Z')
    })
    expect(index).toMatchObject({
      immutable: true,
      completeness: 'partial',
      indexedSampleCount: 3,
      omittedSampleCount: 2,
      parameters: {
        durationUs: 10_000_000,
        intervalUs: 2_000_000,
        maxFrames: 3,
        samplingStrategy: 'uniform-interval-v1',
        embeddingDimensions: 3
      }
    })
    expect(Object.isFrozen(index)).toBe(true)
    expect(Object.isFrozen(index.samples)).toBe(true)
    expect(isValidVisualIndexRecord(index)).toBe(true)
    const tampered = structuredClone(index)
    tampered.samples[0]!.vector[0] = 0.5
    expect(isValidVisualIndexRecord(tampered)).toBe(false)
    const rebound = structuredClone(index)
    rebound.parameters.intervalUs = 3_000_000
    expect(isValidVisualIndexRecord(rebound)).toBe(false)
    const page = searchVisualMoments({ index, queryVector: [1, 0, 0], pageSize: 1 })
    expect(page).toMatchObject({
      totalMatches: 3,
      nextOffset: 1,
      results: [{
        evidenceKind: 'visual-embedding',
        score: 1,
        scoreSemantics: 'uncalibrated-cosine',
        sourceRange: { assetId: 'asset-visual', startUs: 0, endUs: 2_000_000 },
        evidence: { representativeUs: 1_000_000, modelConfidence: 0.9 }
      }],
      ranking: {
        semantics: 'uncalibrated-cosine',
        calibratedConfidence: false,
        local: true,
        networkUsed: false,
        adapterId: descriptor.adapterId,
        modelId: descriptor.modelId
      }
    })
    const agentEvidence = readMediaIntelligenceEvidence(index, { limit: 1 })
    expect(agentEvidence).toMatchObject({
      kind: 'visual-index',
      returned: 1,
      total: 3,
      nextOffset: 1,
      evidence: [{ assetId: 'asset-visual', startUs: 0, endUs: 2_000_000 }]
    })
    expect(JSON.stringify(agentEvidence)).not.toContain('vector')
    expect(() => searchVisualMoments({ index, queryVector: [1, 0] }))
      .toThrowError(/dimensions do not match/u)
    expect(() => searchVisualMoments({ index, queryVector: [0, 0, 0] }))
      .toThrowError(/zero vector/u)
  })

  it('binds immutable indexes to the exact deterministic sampling parameters', () => {
    const capability = negotiateVisualAdapter({
      optIn: true, descriptor, receipt, inferenceBrokerAvailable: true
    })
    if (capability.outcome !== 'ready') throw new Error('expected verified fixture adapter')
    const makeIndex = (maxFrames: number) => {
      const plan = buildFrameSamplingPlan({
        assetId: 'asset-plan-binding',
        durationUs: 12_000_000,
        sourceFingerprint: { algorithm: 'sha256', value: 'e'.repeat(64) },
        intervalUs: 2_000_000,
        maxFrames
      })
      return createVisualIndexRecord({
        capability,
        plan,
        embeddings: plan.samples.map((sample) => ({ sampleId: sample.id, vector: [1, 0, 0] })),
        now: () => new Date('2026-01-02T00:00:00.000Z')
      })
    }
    const sparse = makeIndex(2)
    const denser = makeIndex(3)
    expect(sparse.id).not.toBe(denser.id)
    expect(sparse.parameters.samplingPlanKey).not.toBe(denser.parameters.samplingPlanKey)
  })

  it('fences progress after cancellation and never publishes an incomplete index as ready', () => {
    const tracker = new VisualIndexProgressTracker(4)
    expect(tracker.start()).toMatchObject({ generation: 2, status: 'running' })
    expect(tracker.report(2, 'Embedded two frames')).toMatchObject({ generation: 3, completed: 2 })
    expect(tracker.cancel()).toMatchObject({ generation: 4, status: 'cancelled', completed: 2 })
    expect(() => tracker.complete()).toThrowError(/terminal/u)
  })
})
