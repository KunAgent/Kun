import { createExtensionTestHarness, type ExtensionTestHarness } from '@kun/extension-test'
import {
  MediaAnalyzeVisualFramesRequestSchema,
  MediaEmbedVisualQueryRequestSchema
} from '@kun/extension-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KunLocalAudioAnalysisBroker
} from '../src/host/kun-audio-analysis-broker.js'

const harnesses: ExtensionTestHarness[] = []
const permissions = ['media.read', 'media.process', 'jobs.manage', 'workspace.read']

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()))
})

describe('Kun local audio-analysis Extension API adapter', () => {
  it('maps the public verified visual broker to bounded real-evidence adapter calls', async () => {
    const harness = createHarness()
    const handleId = addVideo(harness, 'fake_visual_video_0001')
    const descriptor = {
      adapterId: 'kun.local.visual-features', adapterVersion: '1.0.0',
      modelId: 'kun-visual-features', modelVersion: '1.0.0',
      packageId: 'kun-bundled.visual-features-v1', manifestSha256: 'a'.repeat(64),
      files: [{ name: 'visual-features-v1.json', sha256: 'b'.repeat(64), byteSize: 582 }],
      embeddingDimensions: 2, execution: 'local' as const,
      querySemantics: 'bounded-visual-features-v1' as const
    }
    harness.media.setVisualModelStatus({
      schemaVersion: 1,
      state: 'installed',
      descriptor,
      receipt: {
        broker: 'kun-model-broker', packageSource: 'bundled',
        packageId: descriptor.packageId, modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion, manifestSha256: descriptor.manifestSha256,
        files: descriptor.files, downloadVerified: false, sourceVerified: true,
        installVerified: true, signatureVerified: true,
        installedAt: '2026-01-01T00:00:00.000Z'
      },
      installSupported: true,
      checkedAt: '2026-01-01T00:00:00.000Z',
      remediation: 'Verified bundled visual features ready.',
      local: true, networkUsedForInference: false, rawPathsExposed: false, urlsAccepted: false
    })
    harness.transport.handle('media.analyzeVisualFrames', (params) => {
      const request = MediaAnalyzeVisualFramesRequestSchema.parse(params)
      return {
        outcome: 'ready',
        source: {
          handleId: request.inputHandleId,
          fingerprint: 'c'.repeat(64),
          fingerprintAlgorithm: 'sha256-file-identity-v1'
        },
        adapter: request.adapter,
        embeddings: request.samples.map((sample, index) => ({
          sampleId: sample.sampleId,
          vector: index === 0 ? [1, 0] : [0, 1]
        })),
        provenance: {
          algorithm: 'kun.rgb-edge-features', algorithmVersion: '1.0.0',
          decodedFrameWidth: 32, decodedFrameHeight: 32, local: true, networkUsed: false
        }
      }
    })
    harness.transport.handle('media.embedVisualQuery', (params) => {
      const request = MediaEmbedVisualQueryRequestSchema.parse(params)
      return request.query === 'red'
        ? {
            outcome: 'ready', adapter: request.adapter, vector: [1, 0],
            matchedConcepts: ['red'], scoreSemantics: 'uncalibrated-cosine',
            local: true, networkUsed: false
          }
        : {
            outcome: 'unavailable', code: 'VISUAL_QUERY_UNSUPPORTED',
            remediation: 'Use supported measured visual concepts.', retryable: false,
            local: true, networkUsed: false
          }
    })
    const broker = new KunLocalAudioAnalysisBroker(harness.context)
    await expect(broker.visualModelStatus!()).resolves.toMatchObject({
      state: 'installed',
      descriptor: { adapterId: descriptor.adapterId, embeddingDimensions: 2 },
      receipt: { packageSource: 'bundled', downloadVerified: false, sourceVerified: true }
    })
    const report = vi.fn(async () => undefined)
    const embeddings = await broker.indexVisual!({
      mediaHandleId: handleId,
      samples: [
        { id: 'frame:asset-1:0', assetId: 'asset-1', startUs: 0, endUs: 1_000_000, representativeUs: 500_000 },
        { id: 'frame:asset-1:1', assetId: 'asset-1', startUs: 1_000_000, endUs: 2_000_000, representativeUs: 1_500_000 }
      ],
      adapter: {
        id: descriptor.adapterId, version: descriptor.adapterVersion,
        modelId: descriptor.modelId, modelVersion: descriptor.modelVersion,
        packageId: descriptor.packageId, manifestSha256: descriptor.manifestSha256,
        embeddingDimensions: descriptor.embeddingDimensions, execution: 'local'
      },
      signal: new AbortController().signal,
      report
    })
    expect(embeddings).toEqual([
      { sampleId: 'frame:asset-1:0', vector: [1, 0] },
      { sampleId: 'frame:asset-1:1', vector: [0, 1] }
    ])
    expect(report).toHaveBeenLastCalledWith(2, 2, 'Measured verified local visual frame features')
    await expect(broker.embedVisualQuery!({
      query: 'red',
      adapter: {
        id: descriptor.adapterId, version: descriptor.adapterVersion,
        modelId: descriptor.modelId, modelVersion: descriptor.modelVersion,
        packageId: descriptor.packageId, manifestSha256: descriptor.manifestSha256,
        embeddingDimensions: descriptor.embeddingDimensions, execution: 'local'
      },
      signal: new AbortController().signal
    })).resolves.toEqual([1, 0])
    await expect(broker.embedVisualQuery!({
      query: 'person smiling',
      adapter: {
        id: descriptor.adapterId, version: descriptor.adapterVersion,
        modelId: descriptor.modelId, modelVersion: descriptor.modelVersion,
        packageId: descriptor.packageId, manifestSha256: descriptor.manifestSha256,
        embeddingDimensions: descriptor.embeddingDimensions, execution: 'local'
      },
      signal: new AbortController().signal
    })).rejects.toMatchObject({
      name: 'KunVisualAnalysisUnavailableError',
      code: 'VISUAL_QUERY_UNSUPPORTED',
      networkUsed: false
    })
    expect(JSON.stringify(harness.transport.requests)).not.toMatch(/\/(?:Users|private|tmp)\//u)
  })

  it('maps durable silence evidence into an honest binary VAD series with provenance', async () => {
    const harness = createHarness()
    const handleId = addAudio(harness, 'fake_audio_silence_0001')
    const broker = new KunLocalAudioAnalysisBroker(harness.context)
    const report = vi.fn(async () => undefined)
    const pending = broker.analyzeVad!({
      mediaHandleId: handleId,
      signal: new AbortController().signal,
      report
    })
    const jobId = await nextJobId(harness)
    harness.jobs.start(jobId)
    harness.jobs.reportProgress(jobId, {
      phase: 'silence-analysis', completed: 1, total: 1, percentage: 100
    })
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      data: {
        schemaVersion: 1,
        analysis: 'silence',
        source: {
          handleId,
          fingerprint: 'a'.repeat(64),
          fingerprintAlgorithm: 'sha256-file-identity-v1'
        },
        provenance: {
          algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        parameters: { noiseThresholdDb: -35, minimumSilenceMicros: 300_000 },
        intervals: [{
          startMicros: 200_000,
          endMicros: 600_000,
          confidence: 1,
          confidenceSemantics: 'threshold-classification'
        }],
        analyzedDurationMicros: 1_000_000,
        truncated: false
      },
      generatedArtifacts: []
    })
    await expect(pending).resolves.toEqual({
      frames: [
        { id: 'host-vad-000001', startUs: 0, endUs: 200_000, speechProbability: 1 },
        { id: 'host-vad-000002', startUs: 200_000, endUs: 600_000, speechProbability: 0 },
        { id: 'host-vad-000003', startUs: 600_000, endUs: 1_000_000, speechProbability: 1 }
      ],
      completeness: 'complete',
      sourceFingerprint: { algorithm: 'sha256', value: 'a'.repeat(64) }
    })
    expect(report).toHaveBeenCalledWith(1, 1, undefined)
    expect(JSON.stringify(harness.transport.requests)).not.toMatch(/\/(?:Users|private|tmp)\//u)
  })

  it('returns seeded bounded sync inputs and verifies handle/result correlation', async () => {
    const harness = createHarness()
    const referenceHandleId = addAudio(harness, 'fake_audio_reference_001')
    const targetHandleId = addAudio(harness, 'fake_audio_target_0000001')
    const broker = new KunLocalAudioAnalysisBroker(harness.context)
    const pending = broker.extractSyncFeatures!({
      referenceHandleId,
      targetHandleId,
      seed: 42,
      signal: new AbortController().signal,
      report: async () => undefined
    })
    const jobId = await nextJobId(harness)
    harness.jobs.start(jobId)
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      data: {
        schemaVersion: 1,
        analysis: 'sync-features',
        reference: {
          handleId: referenceHandleId,
          fingerprint: 'b'.repeat(64),
          fingerprintAlgorithm: 'sha256-file-identity-v1'
        },
        target: {
          handleId: targetHandleId,
          fingerprint: 'c'.repeat(64),
          fingerprintAlgorithm: 'sha256-file-identity-v1'
        },
        provenance: {
          algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        seed: 42,
        samplePeriodMicros: 100_000,
        referenceFeatures: [-1, -0.5, 0, 0.5, 1, 0.25, -0.25, 0.75],
        targetFeatures: [0, -1, -0.5, 0, 0.5, 1, 0.25, -0.25],
        referenceAnalyzedDurationMicros: 800_000,
        targetAnalyzedDurationMicros: 800_000,
        truncated: false
      },
      generatedArtifacts: []
    })
    await expect(pending).resolves.toMatchObject({
      samplePeriodUs: 100_000,
      referenceFeatures: expect.any(Array),
      targetFeatures: expect.any(Array),
      referenceFingerprint: { algorithm: 'sha256', value: 'b'.repeat(64) },
      targetFingerprint: { algorithm: 'sha256', value: 'c'.repeat(64) }
    })
  })

  it('surfaces beat/downbeat unavailability without producing marker evidence', async () => {
    const harness = createHarness()
    const handleId = addAudio(harness, 'fake_audio_beats_000001')
    const broker = new KunLocalAudioAnalysisBroker(harness.context)
    await expect(broker.analyzeBeats!({
      mediaHandleId: handleId,
      signal: new AbortController().signal,
      report: async () => undefined
    })).rejects.toMatchObject({
      name: 'KunAudioAnalysisUnavailableError',
      code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE',
      networkUsed: false,
      retryable: false
    })
    expect(harness.jobs.snapshots.size).toBe(0)
  })

  it('propagates AbortSignal into explicit durable job cancellation', async () => {
    const harness = createHarness()
    const handleId = addAudio(harness, 'fake_audio_cancel_00001')
    const broker = new KunLocalAudioAnalysisBroker(harness.context)
    const controller = new AbortController()
    const pending = broker.analyzeVad!({
      mediaHandleId: handleId,
      signal: controller.signal,
      report: async () => undefined
    })
    const jobId = await nextJobId(harness)
    harness.jobs.start(jobId)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(harness.jobs.get(jobId).state).toBe('cancelled'))
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
    permissions,
    workspace: {
      id: 'workspace-audio-analysis',
      name: 'Audio Analysis',
      root: '/workspace/audio-analysis',
      trusted: true,
      active: true
    }
  })
  harnesses.push(harness)
  return harness
}

function addAudio(harness: ExtensionTestHarness, handleId: string): string {
  harness.media.addHandle({
    handleId,
    mode: 'read',
    kind: 'audio',
    displayName: `${handleId}.wav`,
    mimeType: 'audio/wav'
  })
  return handleId
}

function addVideo(harness: ExtensionTestHarness, handleId: string): string {
  harness.media.addHandle({
    handleId,
    mode: 'read',
    kind: 'video',
    displayName: `${handleId}.mp4`,
    mimeType: 'video/mp4'
  })
  return handleId
}

async function nextJobId(harness: ExtensionTestHarness): Promise<string> {
  await vi.waitFor(() => expect(harness.jobs.snapshots.size).toBe(1))
  return [...harness.jobs.snapshots.keys()][0]!
}
