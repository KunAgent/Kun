import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionAudioAnalysisJobService } from './extension-audio-analysis-job-service.js'
import { ExtensionJobService } from './extension-job-service.js'
import { ExtensionJobStore } from './extension-job-store.js'
import type { ExtensionMediaProcessService } from './extension-media-process-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-audio-analysis-job-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const jobs = new ExtensionJobService({
    store: new ExtensionJobStore({ path: join(root, 'jobs.json') }),
    progressIntervalMs: 0
  })
  const media = {
    audioAnalysisCapabilities: vi.fn(async () => ({
      probedAt: '2026-07-14T00:00:00.000Z',
      executablesAvailable: true,
      silence: true,
      syncFeatures: true,
      beatGrid: true
    })),
    analyzeSilenceForCore: vi.fn(async (_principal, handleId: string) => ({
      source: {
        handleId,
        fingerprint: 'a'.repeat(64),
        fingerprintAlgorithm: 'sha256-file-identity-v1' as const
      },
      intervals: [{
        startMicros: 100_000,
        endMicros: 500_000,
        confidence: 1 as const,
        confidenceSemantics: 'threshold-classification' as const
      }],
      analyzedDurationMicros: 1_000_000,
      truncated: false
    })),
    analyzeBeatGridForCore: vi.fn(async (_principal, handleId: string) => ({
      source: {
        handleId,
        fingerprint: 'd'.repeat(64),
        fingerprintAlgorithm: 'sha256-file-identity-v1' as const
      },
      tempoBpm: 120,
      markers: [
        { timeMicros: 500_000, kind: 'downbeat' as const, confidence: 0.91, strength: 1 },
        { timeMicros: 1_000_000, kind: 'beat' as const, confidence: 0.86, strength: 0.8 }
      ],
      analyzedDurationMicros: 2_000_000,
      truncated: false
    })),
    extractSyncFeaturesForCore: vi.fn(async (_principal, handleId: string) => ({
      source: {
        handleId,
        fingerprint: (handleId.includes('reference') ? 'b' : 'c').repeat(64),
        fingerprintAlgorithm: 'sha256-file-identity-v1' as const
      },
      features: [-1, -0.5, 0, 0.5, 1, 0.25, -0.25, 0.75],
      analyzedDurationMicros: 800_000,
      truncated: false
    }))
  }
  const adapter = new ExtensionAudioAnalysisJobService({
    jobs,
    media: media as unknown as ExtensionMediaProcessService
  })
  const principal: ExtensionPrincipal = {
    extensionId: 'acme.video-editor',
    extensionVersion: '1.1.0',
    permissions: ['jobs.manage', 'media.read', 'media.process', 'workspace.read'],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
  return { root, workspace, jobs, media, adapter, principal }
}

describe('ExtensionAudioAnalysisJobService', () => {
  it('advertises and persists bounded local beat/downbeat evidence without fabricating provider data', async () => {
    const test = await fixture()
    await expect(test.adapter.capabilities(test.principal)).resolves.toMatchObject({
      analyses: [
        { analysis: 'silence', available: true, networkUsed: false },
        {
          analysis: 'beat-grid',
          available: true,
          algorithm: 'kun.pcm-onset-autocorrelation',
          networkUsed: false
        },
        { analysis: 'sync-features', available: true, networkUsed: false }
      ]
    })
    const started = await test.adapter.start(test.principal, {
      analysis: 'beat-grid',
      inputHandleId: 'media_audio_reference_0001',
      maxMarkers: 64
    })
    if (started.outcome !== 'started') throw new Error('expected started beat job')
    await test.jobs.waitForIdle(started.job.jobId)
    const snapshot = await test.jobs.getOwned({
      extensionId: test.principal.extensionId,
      workspaceIds: [extensionWorkspaceKey(test.workspace)]
    }, started.job.jobId)
    expect(snapshot.result?.data).toMatchObject({
      analysis: 'beat-grid',
      tempoBpm: 120,
      provenance: {
        algorithm: 'kun.pcm-onset-autocorrelation',
        local: true,
        networkUsed: false
      },
      markers: [
        { timeMicros: 500_000, kind: 'downbeat', confidence: 0.91 },
        { timeMicros: 1_000_000, kind: 'beat', confidence: 0.86 }
      ]
    })
    expect(test.media.analyzeBeatGridForCore).toHaveBeenCalledWith(
      expect.any(Object),
      'media_audio_reference_0001',
      expect.objectContaining({ maxMarkers: 64, signal: expect.any(AbortSignal) })
    )
    expect(test.media.analyzeSilenceForCore).not.toHaveBeenCalled()
    expect(test.media.extractSyncFeaturesForCore).not.toHaveBeenCalled()
    test.media.audioAnalysisCapabilities.mockResolvedValueOnce({
      probedAt: '2026-07-14T00:00:00.000Z',
      executablesAvailable: true,
      silence: false,
      syncFeatures: false,
      beatGrid: false
    })
    const missingPrimitive = await test.adapter.capabilities(test.principal)
    expect(missingPrimitive.analyses[0]).toMatchObject({
      analysis: 'silence',
      available: false,
      code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE'
    })
    expect(missingPrimitive.analyses[1]).toMatchObject({
      analysis: 'beat-grid',
      available: false,
      code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE'
    })
    test.adapter.dispose()
  })

  it('persists bounded local silence evidence and deduplicates by owner idempotency', async () => {
    const test = await fixture()
    const request = {
      analysis: 'silence' as const,
      inputHandleId: 'media_audio_reference_0001',
      idempotencyKey: 'silence:asset-1:fingerprint-a'
    }
    const first = await test.adapter.start(test.principal, request)
    if (first.outcome !== 'started') throw new Error('expected started silence job')
    await test.jobs.waitForIdle(first.job.jobId)
    const second = await test.adapter.start(test.principal, request)
    if (second.outcome !== 'started') throw new Error('expected idempotent silence job')
    expect(second.job.jobId).toBe(first.job.jobId)
    expect(test.media.analyzeSilenceForCore).toHaveBeenCalledTimes(1)
    const snapshot = await test.jobs.getOwned({
      extensionId: test.principal.extensionId,
      workspaceIds: [extensionWorkspaceKey(test.workspace)]
    }, first.job.jobId)
    expect(snapshot).toMatchObject({
      kind: 'media.audio-analysis',
      initiatingOperation: 'media.startAudioAnalysisJob',
      state: 'completed',
      progress: { completed: 1, total: 1, percentage: 100 },
      result: {
        data: {
          analysis: 'silence',
          provenance: { local: true, networkUsed: false },
          intervals: [{ startMicros: 100_000, endMicros: 500_000 }]
        },
        generatedArtifacts: []
      }
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/\/(?:Users|private|tmp)\//u)
    test.adapter.dispose()
  })

  it('returns seeded bounded correlation inputs without proposing or applying an edit', async () => {
    const test = await fixture()
    const started = await test.adapter.start(test.principal, {
      analysis: 'sync-features',
      referenceHandleId: 'media_audio_reference_0001',
      targetHandleId: 'media_audio_target_00000001',
      seed: 42,
      samplePeriodMicros: 100_000,
      maximumDurationMicros: 10_000_000,
      maxFeaturePoints: 100
    })
    if (started.outcome !== 'started') throw new Error('expected started sync job')
    await test.jobs.waitForIdle(started.job.jobId)
    const snapshot = await test.jobs.getOwned({
      extensionId: test.principal.extensionId,
      workspaceIds: [extensionWorkspaceKey(test.workspace)]
    }, started.job.jobId)
    expect(snapshot.result?.data).toMatchObject({
      analysis: 'sync-features',
      seed: 42,
      samplePeriodMicros: 100_000,
      provenance: { local: true, networkUsed: false }
    })
    expect(snapshot.result?.data).not.toHaveProperty('proposedTargetDeltaUs')
    expect(snapshot.result?.data).not.toHaveProperty('operation')
    expect(test.media.extractSyncFeaturesForCore).toHaveBeenCalledTimes(2)
    test.adapter.dispose()
  })

  it('requires read/process/job/workspace authority before capability or job access', async () => {
    const test = await fixture()
    await expect(test.adapter.capabilities({ ...test.principal, permissions: [] }))
      .rejects.toMatchObject({ code: 'permission_denied', category: 'permission' })
    await expect(test.adapter.capabilities({ ...test.principal, permissions: ['media.process'] }))
      .resolves.toMatchObject({ analyses: expect.any(Array) })
    await expect(test.adapter.start({ ...test.principal, permissions: ['media.process'] }, {
      analysis: 'silence', inputHandleId: 'media_audio_reference_0001'
    })).rejects.toMatchObject({ code: 'permission_denied', category: 'permission' })
    await expect(test.adapter.start({ ...test.principal, workspaceTrusted: false }, {
      analysis: 'silence', inputHandleId: 'media_audio_reference_0001'
    })).rejects.toMatchObject({ code: 'workspace_denied', category: 'scope' })
    test.adapter.dispose()
  })
})
