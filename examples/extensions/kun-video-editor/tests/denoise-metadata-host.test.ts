import { createExtensionTestHarness, type ExtensionTestHarness } from '@kun/extension-test'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  DenoiseMetadataAdapterDescriptor,
  DenoiseNoiseProfileEvidence
} from '../src/engine/index.js'
import { KunLocalAudioAnalysisBroker } from '../src/host/kun-audio-analysis-broker.js'
import {
  MediaIntelligenceService,
  type LocalMediaIntelligenceBroker
} from '../src/host/media-intelligence-service.js'
import { makeProject } from './fixtures.js'

const harnesses: ExtensionTestHarness[] = []
const fingerprint = { algorithm: 'sha256' as const, value: 'e'.repeat(64) }
const descriptor: DenoiseMetadataAdapterDescriptor = {
  adapterId: 'kun.fixture.denoise-metadata',
  adapterVersion: '1.0.0',
  algorithm: 'fixture-noise-profile',
  algorithmVersion: '3.0.0',
  modelId: 'fixture-noise-model',
  modelVersion: '3.2.1'
}
const evidence: DenoiseNoiseProfileEvidence = {
  analyzedDurationUs: 2_000_000,
  sampleWindowCount: 200,
  noiseFloorDbfs: -60,
  averageRmsDbfs: -24,
  peakDbfs: -2,
  spectralBands: [
    { id: 'hum', lowerFrequencyHz: 40, upperFrequencyHz: 80, noiseLevelDbfs: -46, confidence: 0.91 }
  ],
  confidence: 0.84,
  recommendedReductionDb: 7,
  completeness: 'complete'
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()))
})

describe('Host denoise metadata orchestration', () => {
  it('negotiates the current public Kun Broker honestly unavailable', async () => {
    const harness = createHarness()
    const broker = new KunLocalAudioAnalysisBroker(harness.context)
    const service = new MediaIntelligenceService(harness.context, broker)
    const project = makeProject()
    expect(await service.denoiseMetadataCapability()).toMatchObject({
      outcome: 'unavailable',
      code: 'denoise_metadata_algorithm_unavailable',
      local: true,
      networkUsed: false,
      retryable: false
    })
    expect(await service.analyzeDenoiseMetadata({ project, assetId: 'asset-1' })).toMatchObject({
      outcome: 'unavailable',
      code: 'denoise_metadata_algorithm_unavailable',
      networkUsed: false
    })
    expect(await service.listRecords(project.id)).toEqual([])
  })

  it('persists, lists, pages, and grant-binds verified local metadata without changing the project or exposing a handle', async () => {
    let runs = 0
    const broker: LocalMediaIntelligenceBroker = {
      id: descriptor.adapterId,
      version: descriptor.adapterVersion,
      denoiseMetadataCapability: async () => ({
        outcome: 'ready', descriptor, local: true, networkUsed: false
      }),
      analyzeDenoiseMetadata: async ({ report }) => {
        runs += 1
        await report(100, 100, 'Measured bounded local noise profile')
        return { evidence, sourceFingerprint: fingerprint }
      }
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    const project = makeProject()
    project.assets[0]!.sourceIdentity = fingerprint
    const before = structuredClone(project)

    const first = await service.analyzeDenoiseMetadata({
      project, assetId: 'asset-1', confidenceThreshold: 0.7
    })
    const cached = await service.analyzeDenoiseMetadata({
      project, assetId: 'asset-1', confidenceThreshold: 0.7
    })
    expect(first).toMatchObject({
      outcome: 'ready', deduplicated: false,
      record: {
        kind: 'denoise-metadata', status: 'ready', metadataOnly: true,
        recommendation: { reductionDb: 7, autoApplyAllowed: false, audioMutation: 'none' },
        provenance: {
          sourceFingerprint: fingerprint,
          algorithm: descriptor.algorithm,
          algorithmVersion: descriptor.algorithmVersion,
          modelId: descriptor.modelId,
          modelVersion: descriptor.modelVersion,
          local: true,
          networkUsed: false
        }
      }
    })
    expect(cached).toMatchObject({
      outcome: 'ready', deduplicated: true,
      record: { id: first.outcome === 'ready' ? first.record.id : 'missing' }
    })
    expect(runs).toBe(1)
    expect(project).toEqual(before)
    if (first.outcome !== 'ready') throw new Error('expected ready denoise metadata')
    expect(await service.listRecords(project.id)).toEqual([
      expect.objectContaining({ id: first.record.id, kind: 'denoise-metadata' })
    ])
    expect(await service.readEvidence(project.id, first.record.id, { limit: 1 })).toMatchObject({
      kind: 'denoise-metadata',
      returned: 1,
      total: 2,
      nextOffset: 1,
      evidence: [expect.objectContaining({
        evidenceKind: 'noise-profile',
        recommendedReductionDb: 7,
        metadataOnly: true,
        audioMutation: 'none'
      })]
    })
    expect(await service.matchesCurrentGrantBinding(project, first.record)).toBe(true)
    project.assets[0]!.mediaHandleId = 'media_asset_reauthorized_denoise'
    expect(await service.matchesCurrentGrantBinding(project, first.record)).toBe(false)
    expect(JSON.stringify({ first, cached })).not.toContain(before.assets[0]!.mediaHandleId)
  })

  it('refuses a measured profile whose source fingerprint does not match the authorized source', async () => {
    const broker: LocalMediaIntelligenceBroker = {
      id: descriptor.adapterId,
      version: descriptor.adapterVersion,
      denoiseMetadataCapability: async () => ({
        outcome: 'ready', descriptor, local: true, networkUsed: false
      }),
      analyzeDenoiseMetadata: async () => ({
        evidence,
        sourceFingerprint: { algorithm: 'sha256', value: 'f'.repeat(64) }
      })
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    const project = makeProject()
    project.assets[0]!.sourceIdentity = fingerprint
    expect(await service.analyzeDenoiseMetadata({ project, assetId: 'asset-1' })).toMatchObject({
      outcome: 'unavailable',
      code: 'denoise_metadata_source_mismatch',
      networkUsed: false
    })
    expect(await service.listRecords(project.id)).toEqual([])
  })
})

function createHarness(): ExtensionTestHarness {
  const harness = createExtensionTestHarness({
    identity: {
      id: 'kun-examples.kun-video-editor',
      publisher: 'kun-examples',
      name: 'kun-video-editor',
      version: '0.4.0'
    },
    permissions: ['storage.workspace', 'media.read', 'media.process'],
    workspace: {
      id: 'workspace-denoise-metadata',
      name: 'Denoise Metadata',
      root: '/workspace/denoise-metadata',
      trusted: true,
      active: true
    }
  })
  harnesses.push(harness)
  return harness
}
