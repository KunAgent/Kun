import type { JsonObject } from '@kun/extension-api'
import {
  createExtensionTestHarness,
  createGeneratedArtifactFixture,
  type ExtensionTestHarness
} from '@kun/extension-test'
import { afterEach, describe, expect, it } from 'vitest'
import type { VideoProject } from '../src/engine/index.js'
import { DerivedMediaService } from '../src/host/derived-media-service.js'
import { makeProject } from './fixtures.js'

const harnesses: ExtensionTestHarness[] = []
const permissions = [
  'storage.workspace', 'workspace.read', 'workspace.write',
  'media.read', 'media.process', 'media.export', 'jobs.manage', 'ui.views'
]

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()))
})

describe('DerivedMediaService source and access reconciliation', () => {
  it('maps every brokered derived kind onto a revision/source-fenced runtime-scheduled FFmpeg job', async () => {
    for (const kind of ['waveform', 'thumbnail', 'filmstrip', 'proxy', 'proof', 'preview'] as const) {
      const { harness, project, service } = fixture()
      project.currentRevision = 7
      const started = await service.start({
        project,
        assetId: 'asset-1',
        kind,
        priority: kind === 'proof' ? 'export' : 'interactive',
        normalizedParameters: { seekUs: 1_000_000, durationUs: 2_000_000 }
      })
      const request = latestFfmpegRequest(harness)
      expect(request).toMatchObject({
        inputs: { source: 'media_source_original_0001' },
        outputs: { derived: expect.stringMatching(/^fake_cache_target_/u) },
        scheduling: {
          priority: kind === 'proof' ? 'export' : 'interactive',
          maxAttempts: 3,
          retryBaseDelayMs: 250
        },
        metadata: {
          derivedId: started.record.id,
          derivedKind: kind,
          projectId: project.id,
          assetId: 'asset-1',
          pinnedRevision: 7,
          sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
          producerId: `kun-video-editor.${kind}`,
          producerVersion: harness.identity.version
        }
      })
      expect(JSON.stringify(request)).not.toContain(harness.context.workspaceContext!.root)
      await service.cancel(project.id, String(started.record.id))
    }
  })

  it('rejects a completed artifact whose revision provenance no longer matches the scheduled stage', async () => {
    const { harness, project, service } = fixture()
    project.currentRevision = 7
    const started = await service.start({
      project,
      assetId: 'asset-1',
      kind: 'thumbnail',
      normalizedParameters: { seekUs: 1_000_000 }
    })
    const jobId = String(started.jobId)
    const request = latestFfmpegRequest(harness)
    const handleId = String((request.outputs as JsonObject).derived)
    harness.jobs.start(jobId)
    harness.media.addHandle({
      ...mediaMetadata(handleId, 'read', 'stale-thumbnail.png', 'image'),
      byteSize: 1024,
      completionIdentity: 'stale-thumbnail-revision-6'
    })
    harness.jobs.complete(jobId, {
      schemaVersion: 1,
      generatedArtifacts: [createGeneratedArtifactFixture({
        artifactId: 'artifact_stale_thumbnail_revision_0001',
        ownerExtensionId: harness.identity.id,
        ownerExtensionVersion: harness.identity.version,
        workspaceId: harness.context.workspaceContext!.id,
        mediaHandleId: handleId,
        displayName: 'stale-thumbnail.png',
        mediaKind: 'image',
        mimeType: 'image/png',
        byteSize: 1024,
        completionIdentity: 'stale-thumbnail-revision-6',
        provenance: {
          jobId,
          operation: 'media.startFfmpegJob',
          metadata: { ...(request.metadata as JsonObject), pinnedRevision: 6 }
        }
      })]
    })

    await expect(service.list(project.id)).resolves.toMatchObject({
      records: [{
        id: started.record.id,
        status: 'failed',
        bytes: 0,
        artifactHandleId: null,
        error: { code: 'invalid_output', retryable: true }
      }]
    })
    expect(harness.media.handles.get(handleId)?.revoked).toBe(true)
  })

  it('invalidates a running relinked source, cancels work, releases cache, and survives restart', async () => {
    const { harness, project, service } = fixture()
    const started = await service.start({
      project,
      assetId: 'asset-1',
      kind: 'thumbnail',
      normalizedParameters: { seekUs: 1_000_000 }
    })
    const record = started.record
    const jobId = String(started.jobId)
    const outputHandleId = latestOutputHandle(harness)
    expect(record).toMatchObject({ status: 'running', jobId })

    const replacementHandleId = 'media_source_relinked_0002'
    harness.media.addHandle(mediaMetadata(replacementHandleId, 'read', 'replacement.mp4'))
    project.assets[0]!.mediaHandleId = replacementHandleId
    project.assets[0]!.availability = 'online'
    project.assets[0]!.recovery = {
      previousMediaHandleId: 'media_source_original_0001',
      lastVerifiedAt: new Date(harness.clock.now()).toISOString()
    }

    await expect(service.synchronizeProject(project)).resolves.toEqual([
      expect.objectContaining({
        id: record.id,
        status: 'invalid',
        bytes: 0,
        jobId: null,
        artifactHandleId: null,
        error: expect.objectContaining({ code: 'source_changed' })
      })
    ])
    expect(harness.jobs.get(jobId).state).toBe('cancelled')
    expect(harness.media.handles.get(outputHandleId)?.revoked).toBe(true)
    expect(harness.media.handles.get('media_source_original_0001')?.revoked).toBe(false)
    expect(harness.storage.workspace.has(`derived-media:output:${String(record.id)}`)).toBe(false)

    const restarted = derivedService(harness, project)
    await expect(restarted.list(project.id)).resolves.toMatchObject({
      records: [{
        id: record.id,
        status: 'invalid',
        bytes: 0,
        jobId: null,
        artifactHandleId: null,
        error: { code: 'source_changed' }
      }]
    })
  })

  it('imports runtime lease access before quota enforcement and evicts the idle record', async () => {
    const { harness, project } = fixture()
    const service = derivedService(harness, project, 250)
    const first = await completeThumbnail(harness, service, project, 1, 100)
    harness.clock.advance(1_000)
    const second = await completeThumbnail(harness, service, project, 2, 100)

    harness.clock.advance(1_000)
    await harness.context.media.openViewResource({ handleId: String(first.artifactHandleId) })
    const touched = await service.list(project.id)
    expect(touched.records.find(({ id }) => id === first.id)).toMatchObject({
      lastAccessedAt: new Date(harness.clock.now()).toISOString()
    })

    harness.clock.advance(1_000)
    const third = await completeThumbnail(harness, service, project, 3, 100)
    const listed = await service.list(project.id)
    expect(listed.records.map(({ id }) => id)).toEqual(expect.arrayContaining([first.id, third.id]))
    expect(listed.records.map(({ id }) => id)).not.toContain(second.id)
    expect(listed.usage).toMatchObject({ usedBytes: 200, readyBytes: 200, recordCount: 2 })
    expect(harness.media.handles.get(String(first.artifactHandleId))?.revoked).toBe(false)
    expect(harness.media.handles.get(String(second.artifactHandleId))?.revoked).toBe(true)
  })
})

function fixture(): {
  harness: ExtensionTestHarness
  project: VideoProject
  service: DerivedMediaService
} {
  const harness = createExtensionTestHarness({
    identity: {
      id: 'kun-examples.kun-video-editor',
      publisher: 'kun-examples',
      name: 'kun-video-editor',
      version: '0.4.0'
    },
    permissions,
    workspace: {
      id: 'derived-service-workspace',
      name: 'Derived Service',
      root: '/workspace',
      trusted: true,
      active: true
    }
  })
  harnesses.push(harness)
  const project = makeProject()
  project.id = 'derived-service-project'
  project.assets[0]!.mediaHandleId = 'media_source_original_0001'
  project.assets[0]!.availability = 'online'
  harness.media.addHandle(mediaMetadata('media_source_original_0001', 'read', 'interview.mp4'))
  return { harness, project, service: derivedService(harness, project) }
}

function derivedService(
  harness: ExtensionTestHarness,
  project: VideoProject,
  quotaBytes = 2 * 1024 * 1024 * 1024
): DerivedMediaService {
  return new DerivedMediaService(harness.context, {
    loadProject: async (projectId) => projectId === project.id ? structuredClone(project) : undefined,
    store: {
      quotaBytes,
      now: () => new Date(harness.clock.now())
    }
  })
}

async function completeThumbnail(
  harness: ExtensionTestHarness,
  service: DerivedMediaService,
  project: VideoProject,
  frame: number,
  byteSize: number
): Promise<JsonObject> {
  const started = await service.start({
    project,
    assetId: 'asset-1',
    kind: 'thumbnail',
    normalizedParameters: { seekUs: frame * 100_000 }
  })
  const jobId = String(started.jobId)
  const request = latestFfmpegRequest(harness)
  const handleId = String((request.outputs as JsonObject).derived)
  harness.jobs.start(jobId)
  harness.media.addHandle({
    ...mediaMetadata(handleId, 'read', `thumbnail-${frame}.png`, 'image'),
    byteSize,
    completionIdentity: `thumbnail-${frame}-${byteSize}`
  })
  harness.jobs.complete(jobId, {
    schemaVersion: 1,
    generatedArtifacts: [createGeneratedArtifactFixture({
      artifactId: `artifact_thumbnail_${frame}_0001`,
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: handleId,
      displayName: `thumbnail-${frame}.png`,
      mediaKind: 'image',
      mimeType: 'image/png',
      byteSize,
      completionIdentity: `thumbnail-${frame}-${byteSize}`,
      provenance: {
        jobId,
        operation: 'media.startFfmpegJob',
        metadata: request.metadata as JsonObject
      }
    })]
  })
  const listed = await service.list(project.id)
  const ready = listed.records.find(({ id }) => id === started.record.id)
  if (!ready) throw new Error('Derived thumbnail did not reconcile')
  return ready
}

function latestOutputHandle(harness: ExtensionTestHarness): string {
  const request = latestFfmpegRequest(harness)
  return String((request.outputs as JsonObject).derived)
}

function latestFfmpegRequest(harness: ExtensionTestHarness): JsonObject {
  const request = harness.transport.requests
    .filter(({ method }) => method === 'media.startFfmpegJob')
    .at(-1)?.params
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Expected a brokered FFmpeg request')
  }
  return request
}

function mediaMetadata(
  handleId: string,
  mode: 'read' | 'export',
  displayName: string,
  kind: 'video' | 'image' = 'video'
): JsonObject {
  return {
    handleId,
    mode,
    kind,
    displayName,
    mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
    byteSize: mode === 'read' ? 4096 : 0,
    revoked: false
  }
}
