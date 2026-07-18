import { createExtensionTestHarness, type ExtensionTestHarness } from '@kun/extension-test'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  LocalMediaIntelligenceBroker,
  MediaIntelligenceProgress
} from '../src/host/media-intelligence-service.js'
import { MediaIntelligenceService } from '../src/host/media-intelligence-service.js'
import type { VisualModelDescriptor, VisualModelInstallReceipt } from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

const harnesses: ExtensionTestHarness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()))
})

const descriptor: VisualModelDescriptor = {
  adapterId: 'kun.local.visual-fixture',
  adapterVersion: '1.0.0',
  modelId: 'visual-fixture',
  modelVersion: '1.0.0',
  packageId: 'kun-model.visual-fixture',
  manifestSha256: '1'.repeat(64),
  files: [{ name: 'visual.bin', sha256: '2'.repeat(64), byteSize: 2_048 }],
  embeddingDimensions: 2
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

describe('Host media-intelligence orchestration', () => {
  it('keeps search available while returning honest model/analysis unavailable states', async () => {
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context)
    const project = makeProject()
    expect(service.search(project, { query: 'hello', kinds: ['spoken'] })).toMatchObject({
      results: [{
        evidenceKind: 'spoken',
        sourceRange: { assetId: 'asset-1', startUs: 0, endUs: 1_000_000 }
      }]
    })
    expect(service.visualCapability({ optIn: true, descriptor, receipt })).toMatchObject({
      outcome: 'unavailable',
      code: 'visual_inference_broker_unavailable',
      networkUsedForInference: false
    })
    expect(await service.visualProvisioning()).toMatchObject({
      optIn: false,
      state: 'disabled',
      code: 'visual_model_disabled',
      local: true,
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false
    })
    expect(await service.setVisualOptIn(true)).toMatchObject({
      optIn: true,
      state: 'broker-unavailable',
      code: 'visual_model_broker_unavailable',
      installSupported: false
    })
    expect(await service.requestVisualModelInstall()).toMatchObject({
      outcome: 'unavailable',
      capability: { code: 'visual_model_broker_unavailable' }
    })
    expect(await service.analyzeVad({ project, assetId: 'asset-1' })).toEqual({
      outcome: 'unavailable',
      code: 'vad_broker_unavailable',
      remediation: 'No approved local VAD broker is available.',
      networkUsed: false
    })
    expect(await service.listRecords(project.id)).toEqual([])
    expect(JSON.stringify(harness.webview.messages)).not.toMatch(/\/(?:Users|private|tmp)\//u)
  })

  it('requires workspace opt-in before an approved Broker can install and attest a local visual model', async () => {
    let installed = false
    let installCalls = 0
    const broker: LocalMediaIntelligenceBroker = {
      id: 'kun.fixture.visual-installer',
      version: '1.0.0',
      visualModelStatus: async () => ({
        schemaVersion: 1,
        state: installed ? 'installed' : 'missing',
        descriptor,
        ...(installed ? { receipt } : {}),
        installSupported: true,
        checkedAt: '2026-01-02T00:00:00.000Z',
        remediation: installed ? 'Verified fixture ready.' : 'Install the verified fixture.'
      }),
      requestVisualModelInstall: async (request) => {
        installCalls += 1
        expect(Object.keys(request)).toEqual(['signal'])
        expect(request.signal.aborted).toBe(false)
        installed = true
        return {
          schemaVersion: 1,
          state: 'installed',
          descriptor,
          receipt,
          installSupported: true,
          checkedAt: '2026-01-02T00:00:00.000Z',
          remediation: 'Verified fixture ready.'
        }
      },
      indexVisual: async ({ samples }) => samples.map((sample) => ({
        sampleId: sample.id,
        vector: [1, 0]
      })),
      embedVisualQuery: async () => [1, 0]
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    expect(await service.requestVisualModelInstall()).toMatchObject({
      outcome: 'unavailable',
      capability: { state: 'disabled', code: 'visual_model_disabled' }
    })
    expect(installCalls).toBe(0)
    expect(await service.setVisualOptIn(true)).toMatchObject({
      state: 'missing',
      code: 'visual_model_missing',
      installSupported: true
    })
    expect(await service.requestVisualModelInstall()).toMatchObject({
      outcome: 'ready',
      capability: {
        state: 'ready',
        code: 'visual_model_ready',
        verification: {
          brokerAttested: true,
          downloadVerified: true,
          sourceVerified: true,
          installVerified: true,
          signatureVerified: true,
          manifestVerified: true
        },
        rawPathsExposed: false,
        urlsAccepted: false
      }
    })
    expect(installCalls).toBe(1)
  })

  it('verifies, indexes, reports monotonic progress, deduplicates, searches moments, and caches VAD', async () => {
    let visualRuns = 0
    const broker: LocalMediaIntelligenceBroker = {
      id: 'kun.fixture.media-intelligence',
      version: '1.0.0',
      visualModelStatus: async () => ({
        schemaVersion: 1,
        state: 'installed',
        descriptor,
        receipt,
        installSupported: false,
        checkedAt: '2026-01-02T00:00:00.000Z',
        remediation: 'The verified fixture is ready.'
      }),
      indexVisual: async ({ samples, report }) => {
        visualRuns += 1
        await report(1, samples.length, 'Embedded first bounded frame')
        await report(samples.length, samples.length, 'Embedded all bounded frames')
        return samples.map((sample, index) => ({
          sampleId: sample.id,
          vector: index === 0 ? [1, 0] : [0, 1],
          confidence: 0.9
        }))
      },
      embedVisualQuery: async () => [1, 0],
      analyzeVad: async ({ report }) => {
        await report(1, 1, 'Measured local speech probability')
        return {
          frames: [{ id: 'vad-host-1', startUs: 0, endUs: 500_000, speechProbability: 0.05 }],
          completeness: 'complete'
        }
      }
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    expect(await service.setVisualOptIn(true)).toMatchObject({
      state: 'ready',
      code: 'visual_model_ready',
      verification: {
        brokerAttested: true,
        downloadVerified: true,
        sourceVerified: true,
        installVerified: true,
        signatureVerified: true,
        manifestVerified: true
      }
    })
    const project = makeProject()
    project.assets[0]!.sourceIdentity = { algorithm: 'sha256', value: '3'.repeat(64) }
    const first = await service.startVisualIndex({
      project,
      assetId: 'asset-1',
      intervalUs: 5_000_000,
      maxFrames: 2
    })
    expect(first).toMatchObject({
      outcome: 'ready',
      deduplicated: false,
      record: { immutable: true, indexedSampleCount: 2, plannedSampleCount: 2 }
    })
    if (first.outcome !== 'ready') throw new Error('expected visual index')
    const second = await service.startVisualIndex({
      project,
      assetId: 'asset-1',
      intervalUs: 5_000_000,
      maxFrames: 2
    })
    expect(second).toMatchObject({ outcome: 'ready', deduplicated: true, record: { id: first.record.id } })
    expect(visualRuns).toBe(1)
    expect(await service.searchVisual({
      project,
      indexId: first.record.id,
      query: 'opening interview frame',
      pageSize: 1
    })).toMatchObject({
      outcome: 'ready',
      page: { results: [{ score: 1, sourceRange: { assetId: 'asset-1', startUs: 0 } }] }
    })

    const vad = await service.analyzeVad({ project, assetId: 'asset-1' })
    expect(vad).toMatchObject({
      outcome: 'ready',
      record: {
        kind: 'vad',
        provenance: { local: true, networkUsed: false, adapterId: broker.id },
        silence: [{ disposition: 'safe-to-suggest' }]
      }
    })
    const records = await service.listRecords(project.id)
    expect(records.map(({ id }) => id).sort()).toEqual([
      first.record.id,
      vad.outcome === 'ready' ? vad.record.id : 'missing-vad'
    ].sort())
    expect(await service.readEvidence(project.id, first.record.id, { limit: 1 })).toMatchObject({
      kind: 'visual-index', returned: 1, total: 2, nextOffset: 1
    })

    const progress = harness.webview.messages.flatMap((message) => {
      if (!isRecord(message) || message.channel !== 'kun-video-editor.media-intelligence-progress') return []
      return [message.payload as unknown as MediaIntelligenceProgress]
    }).filter(({ operationId }) => operationId === first.operationId)
    expect(progress.map(({ generation }) => generation)).toEqual(
      [...progress.map(({ generation }) => generation)].sort((left, right) => left - right)
    )
    expect(progress.map(({ status }) => status)).toEqual(expect.arrayContaining(['queued', 'running', 'ready']))
    expect(JSON.stringify({ records, progress })).not.toContain(project.assets[0]!.mediaHandleId)
  })

  it('cancels an in-flight local analysis and never publishes a partial record as ready', async () => {
    let brokerWaiting = false
    const broker: LocalMediaIntelligenceBroker = {
      id: 'kun.fixture.cancellable',
      version: '1.0.0',
      analyzeVad: async ({ signal, report }) => {
        await report(1, 2, 'First window measured')
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            reject(error)
            return
          }
          signal.addEventListener('abort', () => {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
          brokerWaiting = true
        })
        return { frames: [], completeness: 'partial' }
      }
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    const project = makeProject()
    const pending = service.analyzeVad({ project, assetId: 'asset-1' })
    await waitFor(() => brokerWaiting && progressMessages(harness).some(({ kind, status }) => kind === 'vad' && status === 'running'))
    const operation = progressMessages(harness)
      .filter(({ kind, status }) => kind === 'vad' && status === 'running')
      .at(-1)!
    expect(await service.cancel(operation.operationId)).toBe(true)
    expect(await pending).toEqual({ outcome: 'cancelled', operationId: operation.operationId })
    expect(await service.listRecords(project.id)).toEqual([])
    expect(progressMessages(harness).filter(({ operationId }) => operationId === operation.operationId).at(-1))
      .toMatchObject({ status: 'cancelled' })
  })

  it('fences externally cancelled visual indexing even when a Broker returns after cancellation', async () => {
    let releaseBroker: (() => void) | undefined
    let brokerWaiting = false
    const broker: LocalMediaIntelligenceBroker = {
      id: 'kun.fixture.visual-cancellable',
      version: '1.0.0',
      visualModelStatus: async () => ({
        schemaVersion: 1,
        state: 'installed',
        descriptor,
        receipt,
        installSupported: false,
        checkedAt: '2026-01-02T00:00:00.000Z',
        remediation: 'Verified fixture ready.'
      }),
      indexVisual: async ({ samples, report }) => {
        await report(1, samples.length, 'Embedded one deterministic sample')
        await new Promise<void>((resolve) => {
          brokerWaiting = true
          releaseBroker = resolve
        })
        return samples.map((sample) => ({ sampleId: sample.id, vector: [1, 0] }))
      },
      embedVisualQuery: async () => [1, 0]
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    await service.setVisualOptIn(true)
    const project = makeProject()
    project.assets[0]!.sourceIdentity = { algorithm: 'sha256', value: '7'.repeat(64) }
    const cancellation = new AbortController()
    const pending = service.startVisualIndex({
      project,
      assetId: 'asset-1',
      maxFrames: 2,
      signal: cancellation.signal
    })
    await waitFor(() => brokerWaiting && progressMessages(harness)
      .some(({ kind, status }) => kind === 'visual-index' && status === 'running'))
    const operation = progressMessages(harness)
      .filter(({ kind, status }) => kind === 'visual-index' && status === 'running')
      .at(-1)!
    cancellation.abort()
    releaseBroker?.()
    expect(await pending).toEqual({ outcome: 'cancelled', operationId: operation.operationId })
    expect(await service.listRecords(project.id)).toEqual([])
    expect(progressMessages(harness).filter(({ operationId }) => operationId === operation.operationId).at(-1))
      .toMatchObject({ status: 'cancelled', message: 'Local visual indexing cancelled' })
  })

  it('rejects visual search after a source grant changes and after the verified model identity changes', async () => {
    let modelDescriptor = descriptor
    let modelReceipt = receipt
    let visualRuns = 0
    const broker: LocalMediaIntelligenceBroker = {
      id: 'kun.fixture.visual-binding',
      version: '1.0.0',
      visualModelStatus: async () => ({
        schemaVersion: 1,
        state: 'installed',
        descriptor: modelDescriptor,
        receipt: modelReceipt,
        installSupported: false,
        checkedAt: '2026-01-02T00:00:00.000Z',
        remediation: 'Verified fixture ready.'
      }),
      indexVisual: async ({ samples }) => {
        visualRuns += 1
        return samples.map((sample) => ({ sampleId: sample.id, vector: [1, 0] }))
      },
      embedVisualQuery: async () => [1, 0]
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    await service.setVisualOptIn(true)
    const project = makeProject()
    project.assets[0]!.sourceIdentity = { algorithm: 'sha256', value: '8'.repeat(64) }
    const originalHandle = project.assets[0]!.mediaHandleId
    const first = await service.startVisualIndex({ project, assetId: 'asset-1', maxFrames: 2 })
    if (first.outcome !== 'ready') throw new Error('expected verified visual index')
    project.assets[0]!.mediaHandleId = 'media_asset_reauthorized_visual'
    expect(await service.searchVisual({ project, indexId: first.record.id, query: 'presenter' })).toMatchObject({
      outcome: 'unavailable',
      code: 'visual_index_stale',
      networkUsed: false
    })
    const rebound = await service.startVisualIndex({ project, assetId: 'asset-1', maxFrames: 2 })
    expect(rebound).toMatchObject({ outcome: 'ready', deduplicated: true, record: { id: first.record.id } })
    expect(visualRuns).toBe(2)
    expect(await service.searchVisual({ project, indexId: first.record.id, query: 'presenter' }))
      .toMatchObject({ outcome: 'ready' })

    modelDescriptor = {
      ...descriptor,
      modelVersion: '2.0.0',
      packageId: 'kun-model.visual-fixture-v2',
      manifestSha256: '9'.repeat(64)
    }
    modelReceipt = {
      ...receipt,
      packageId: modelDescriptor.packageId,
      modelVersion: modelDescriptor.modelVersion,
      manifestSha256: modelDescriptor.manifestSha256
    }
    expect(await service.searchVisual({ project, indexId: first.record.id, query: 'presenter' })).toMatchObject({
      outcome: 'unavailable',
      code: 'visual_model_changed',
      networkUsed: false
    })
    expect(JSON.stringify(await service.listRecords(project.id))).not.toContain(originalHandle)
  })

  it('persists reviewed speaker identities and immutable imported turns with grant-bound deduplication', async () => {
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context)
    const project = makeProject()
    project.assets[0]!.sourceIdentity = { algorithm: 'sha256', value: '6'.repeat(64) }
    const timestamp = '2026-07-14T00:00:00.000Z'
    const request = {
      project,
      assetId: 'asset-1',
      identities: [{
        id: 'speaker-alice', label: 'Alice', aliases: ['Host'],
        sourceEvidenceIds: ['review-alice'], createdAt: timestamp, updatedAt: timestamp
      }],
      turns: [
        { id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified' as const, speakerId: 'speaker-alice', confidence: 0.98 },
        { id: 'turn-unknown', startUs: 1_000_000, endUs: 2_000_000, status: 'unknown' as const, confidence: 0.9 }
      ]
    }
    expect(service.speakerAdapters()).toEqual(expect.arrayContaining([
      expect.objectContaining({ descriptor: expect.objectContaining({ execution: 'import' }), outcome: 'ready' }),
      expect.objectContaining({ descriptor: expect.objectContaining({ execution: 'local-model' }), outcome: 'unavailable' })
    ]))
    const first = await service.importSpeakerEvidence(request)
    expect(first).toMatchObject({
      outcome: 'ready', deduplicated: false,
      record: {
        kind: 'speaker-diarization', uncertainTurnCount: 1,
        provenance: { execution: 'import', local: true, networkUsed: false }
      }
    })
    const second = await service.importSpeakerEvidence(request)
    expect(second).toMatchObject({
      outcome: 'ready', deduplicated: true,
      record: { id: first.outcome === 'ready' ? first.record.id : 'missing' }
    })
    expect(await service.listSpeakerIdentities(project.id)).toEqual([
      expect.objectContaining({ id: 'speaker-alice', label: 'Alice', aliases: ['Host'] })
    ])
    if (first.outcome !== 'ready') throw new Error('expected imported speaker evidence')
    expect(await service.matchesCurrentGrantBinding(project, first.record)).toBe(true)
    project.assets[0]!.mediaHandleId = 'media_asset_reauthorized'
    expect(await service.matchesCurrentGrantBinding(project, first.record)).toBe(false)
    expect(JSON.stringify({ records: await service.listRecords(project.id), messages: harness.webview.messages }))
      .not.toMatch(/\/(?:Users|private|tmp)\//u)
  })

  it('cancels speaker import before persistence and leaves identity storage unchanged', async () => {
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context)
    const project = makeProject()
    const cancellation = new AbortController()
    cancellation.abort()
    const timestamp = '2026-07-14T00:00:00.000Z'
    const outcome = await service.importSpeakerEvidence({
      project,
      assetId: 'asset-1',
      identities: [{
        id: 'speaker-alice', label: 'Alice', aliases: [], sourceEvidenceIds: [],
        createdAt: timestamp, updatedAt: timestamp
      }],
      turns: [{
        id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified',
        speakerId: 'speaker-alice', confidence: 0.99
      }],
      signal: cancellation.signal
    })
    expect(outcome).toMatchObject({ outcome: 'cancelled' })
    expect(await service.listRecords(project.id)).toEqual([])
    expect(await service.listSpeakerIdentities(project.id)).toEqual([])
  })

  it('reuses only exact source- and parameter-bound synchronization records', async () => {
    let syncRuns = 0
    const referenceFingerprint = { algorithm: 'sha256' as const, value: '4'.repeat(64) }
    const targetFingerprint = { algorithm: 'sha256' as const, value: '5'.repeat(64) }
    const broker: LocalMediaIntelligenceBroker = {
      id: 'kun.fixture.sync',
      version: '2.0.0',
      extractSyncFeatures: async () => {
        syncRuns += 1
        const referenceFeatures = [0.2, 0.8, 0.1, 0.5, 0.9, 0.3, 0.7, 0.05, 0.6, 0.4, 0.85, 0.15]
        return {
          referenceFeatures,
          targetFeatures: [0, ...referenceFeatures],
          samplePeriodUs: 100_000,
          referenceFingerprint,
          targetFingerprint
        }
      }
    }
    const harness = createHarness()
    const service = new MediaIntelligenceService(harness.context, broker)
    const project = makeProject()
    project.assets[0]!.sourceIdentity = referenceFingerprint
    project.assets.push({
      id: 'asset-sync-target',
      name: 'Sync target.wav',
      kind: 'audio',
      mediaHandleId: 'media_sync_target_0001',
      durationUs: 2_000_000,
      container: 'wav',
      audio: { codec: 'pcm_s16le', sampleRate: 48_000, channels: 1 },
      sourceIdentity: targetFingerprint,
      transcriptIds: []
    })
    const request = {
      project,
      referenceAssetId: project.assets[0]!.id,
      targetAssetId: 'asset-sync-target',
      seed: 42,
      maximumOffsetUs: 500_000
    }
    const first = await service.analyzeSync(request)
    const cached = await service.analyzeSync(request)
    const narrower = await service.analyzeSync({ ...request, maximumOffsetUs: 100_000 })
    expect(first).toMatchObject({
      outcome: 'ready',
      deduplicated: false,
      record: {
        provenance: { adapterId: broker.id, adapterVersion: broker.version }
      }
    })
    expect(cached).toMatchObject({
      outcome: 'ready',
      deduplicated: true,
      record: { id: first.outcome === 'ready' ? first.record.id : 'missing' }
    })
    expect(narrower).toMatchObject({ outcome: 'ready' })
    expect(syncRuns).toBe(2)
    if (first.outcome === 'ready' && narrower.outcome === 'ready') {
      expect(narrower.record.id).not.toBe(first.record.id)
      expect(await service.matchesCurrentGrantBinding(project, first.record)).toBe(true)
      project.assets.find(({ id }) => id === 'asset-sync-target')!.mediaHandleId = 'media_sync_target_reauthorized'
      expect(await service.matchesCurrentGrantBinding(project, first.record)).toBe(false)
      const reverified = await service.analyzeSync(request)
      expect(reverified).toMatchObject({
        outcome: 'ready',
        deduplicated: true,
        record: { id: first.record.id }
      })
      expect(await service.matchesCurrentGrantBinding(project, first.record)).toBe(true)
      expect(syncRuns).toBe(3)
    }
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
    permissions: ['storage.workspace'],
    workspace: {
      id: 'workspace-media-intelligence',
      name: 'Media Intelligence',
      root: '/workspace/media-intelligence',
      trusted: true,
      active: true
    }
  })
  harnesses.push(harness)
  return harness
}

function progressMessages(harness: ExtensionTestHarness): MediaIntelligenceProgress[] {
  return harness.webview.messages.flatMap((message) => {
    if (!isRecord(message) || message.channel !== 'kun-video-editor.media-intelligence-progress') return []
    return [message.payload as unknown as MediaIntelligenceProgress]
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for Host progress evidence')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
