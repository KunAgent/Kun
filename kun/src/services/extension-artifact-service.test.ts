import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionArtifactService } from './extension-artifact-service.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-artifacts-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  await mkdir(join(workspace, 'exports'), { recursive: true })
  const principal: ExtensionPrincipal = {
    extensionId: 'kun.video-editor',
    extensionVersion: '1.1.0',
    permissions: ['media.read', 'media.export', 'workspace.read', 'workspace.write'],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
  const handles = new ExtensionMediaHandleService({ dataDir })
  const output = await handles.register(principal, {
    workspaceRoot: workspace,
    path: 'exports/final.mp4',
    mode: 'write',
    source: 'workspace'
  })
  await handles.reserveOutput(principal, output.id, 'job_12345678')
  await writeFile(join(workspace, 'exports', 'final.mp4'), Buffer.from('completed-video'))
  const generated = await handles.completeOutput(principal, output.id, 'job_12345678')
  const artifacts = new ExtensionArtifactService({ dataDir, handleService: handles })
  const workspaceId = extensionWorkspaceKey(workspace)
  return { root, workspace, workspaceId, dataDir, principal, handles, generated, artifacts }
}

async function completedOutput(
  test: Awaited<ReturnType<typeof fixture>>,
  relativePath: string,
  contents: string,
  reservationId: string
) {
  const output = await test.handles.register(test.principal, {
    workspaceRoot: test.workspace,
    path: relativePath,
    mode: 'write',
    source: 'workspace'
  })
  await test.handles.reserveOutput(test.principal, output.id, reservationId)
  await writeFile(join(test.workspace, relativePath), Buffer.from(contents))
  return await test.handles.completeOutput(test.principal, output.id, reservationId)
}

describe('ExtensionArtifactService', () => {
  it('publishes a durable path-free artifact from completed generated media', async () => {
    const test = await fixture()
    const artifact = await test.artifacts.create(test.principal, {
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      durationMicros: 1_500_000,
      provenance: { jobId: 'job_12345678', operation: 'video-render' }
    })
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      ownerExtensionId: 'kun.video-editor',
      ownerExtensionVersion: '1.1.0',
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      displayName: 'final.mp4',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      byteSize: 15,
      durationMicros: 1_500_000,
      availability: 'available'
    })
    expect(artifact.completionIdentity.length).toBeGreaterThan(16)
    expect(JSON.stringify(artifact)).not.toContain(join(test.workspace, 'exports'))
    expect(JSON.stringify(artifact)).not.toContain(test.workspace)
    await expect(test.artifacts.validateToolResult(test.principal, test.workspaceId, [artifact]))
      .resolves.toEqual([artifact])
    const reopened = new ExtensionArtifactService({
      dataDir: test.dataDir,
      handleService: test.handles
    })
    await expect(reopened.getOwned(test.principal, artifact.artifactId)).resolves.toEqual(artifact)
    await expect(reopened.getOwned(
      { ...test.principal, extensionId: 'foreign.video-editor' },
      artifact.artifactId
    )).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects fabricated or cross-workspace artifacts', async () => {
    const test = await fixture()
    const artifact = await test.artifacts.create(test.principal, {
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { invocationId: 'invocation-1', operation: 'video-render' }
    })
    await expect(test.artifacts.validateToolResult(test.principal, test.workspaceId, [{
      ...artifact,
      byteSize: artifact.byteSize + 1
    }])).rejects.toMatchObject({ code: 'invalid_artifact' })
    await expect(test.artifacts.create(test.principal, {
      workspaceId: extensionWorkspaceKey(join(test.root, 'other')),
      mediaHandleId: test.generated.id,
      provenance: { invocationId: 'invocation-1', operation: 'video-render' }
    })).rejects.toMatchObject({ code: 'workspace_denied' })
  })

  it('keeps the activation key for an absolute symlink workspace root', async () => {
    const test = await fixture()
    const symlinkRoot = join(test.root, 'workspace-link')
    await symlink(test.workspace, symlinkRoot, 'dir')
    const principal = { ...test.principal, workspaceRoots: [symlinkRoot] }
    const workspaceId = extensionWorkspaceKey(symlinkRoot)

    expect(workspaceId).not.toBe(test.workspaceId)
    await expect(test.artifacts.create(principal, {
      workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { jobId: 'job_symlink_root', operation: 'video-render' }
    })).resolves.toMatchObject({ workspaceId })
  })

  it('publishes a completed output set atomically in one batch', async () => {
    const test = await fixture()
    const subtitle = await completedOutput(
      test,
      'exports/captions.srt',
      '1\n00:00:00,000 --> 00:00:01,000\nHello\n',
      'job_batch_123456'
    )
    const artifacts = await test.artifacts.createMany(test.principal, [{
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      durationMicros: 1_500_000,
      provenance: {
        jobId: 'job_batch_123456',
        operation: 'media.startFfmpegJob',
        metadata: { projectId: 'project-1', pinnedRevision: 7 }
      }
    }, {
      workspaceId: test.workspaceId,
      mediaHandleId: subtitle.id,
      provenance: {
        jobId: 'job_batch_123456',
        operation: 'media.startFfmpegJob',
        metadata: { projectId: 'project-1', pinnedRevision: 7 }
      }
    }])
    expect(artifacts).toHaveLength(2)
    expect(artifacts.map(({ mediaKind }) => mediaKind)).toEqual(['video', 'subtitle'])
    expect(artifacts[1]).toMatchObject({
      mimeType: 'application/x-subrip',
      provenance: { metadata: { projectId: 'project-1', pinnedRevision: 7 } }
    })
    await expect(test.artifacts.listOwned(test.principal, test.workspaceId))
      .resolves.toHaveLength(2)
  })

  it('publishes zero artifacts when any batch member or the batch quota fails', async () => {
    const test = await fixture()
    await expect(test.artifacts.createMany(test.principal, [{
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { jobId: 'job_invalid_batch', operation: 'media.startFfmpegJob' }
    }, {
      workspaceId: test.workspaceId,
      mediaHandleId: 'media_missing_123456',
      provenance: { jobId: 'job_invalid_batch', operation: 'media.startFfmpegJob' }
    }])).rejects.toBeDefined()
    await expect(test.artifacts.listOwned(test.principal, test.workspaceId)).resolves.toEqual([])

    const subtitle = await completedOutput(
      test,
      'exports/captions.vtt',
      'WEBVTT\n\ncue\n00:00:00.000 --> 00:00:01.000\nHello\n',
      'job_quota_batch'
    )
    const limited = new ExtensionArtifactService({
      dataDir: test.dataDir,
      handleService: test.handles,
      maxArtifactsPerExtension: 1
    })
    await expect(limited.createMany(test.principal, [{
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { jobId: 'job_quota_batch', operation: 'media.startFfmpegJob' }
    }, {
      workspaceId: test.workspaceId,
      mediaHandleId: subtitle.id,
      provenance: { jobId: 'job_quota_batch', operation: 'media.startFfmpegJob' }
    }])).rejects.toMatchObject({ code: 'artifact_limit' })
    await expect(limited.listOwned(test.principal, test.workspaceId)).resolves.toEqual([])
  })

  it('hard-deletes only an uncommitted job artifact record and retains promoted output', async () => {
    const test = await fixture()
    const artifact = await test.artifacts.create(test.principal, {
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { jobId: 'job_discard_123456', operation: 'media.startFfmpegJob' }
    })

    await expect(test.artifacts.discardUncommittedJobArtifacts(
      test.principal,
      'job_discard_123456',
      [artifact]
    )).resolves.toBe(1)
    await expect(test.artifacts.listOwned(test.principal, test.workspaceId)).resolves.toEqual([])
    await expect(test.handles.resolve(test.principal, test.generated.id, 'read')).resolves.toMatchObject({
      id: test.generated.id,
      source: 'generated'
    })
    await expect(test.artifacts.discardUncommittedJobArtifacts(
      test.principal,
      'job_discard_123456',
      [artifact]
    )).resolves.toBe(0)
  })

  it('removes only the owning job artifacts during terminal restart cleanup', async () => {
    const test = await fixture()
    await test.artifacts.create(test.principal, {
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { jobId: 'job_interrupted_123', operation: 'media.startFfmpegJob' }
    })
    await test.artifacts.create(test.principal, {
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { jobId: 'job_completed_456', operation: 'media.startFfmpegJob' }
    })

    await expect(test.artifacts.discardUncommittedJobArtifactsByJob(
      test.principal,
      'job_interrupted_123'
    )).resolves.toBe(1)
    await expect(test.artifacts.discardUncommittedJobArtifactsByJob(
      test.principal,
      'job_interrupted_123'
    )).resolves.toBe(0)
    await expect(test.artifacts.listOwned(test.principal, test.workspaceId)).resolves.toEqual([
      expect.objectContaining({ provenance: expect.objectContaining({ jobId: 'job_completed_456' }) })
    ])
  })

  it('refuses to discard an artifact owned by another job', async () => {
    const test = await fixture()
    const artifact = await test.artifacts.create(test.principal, {
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { jobId: 'job_owner_12345678', operation: 'media.startFfmpegJob' }
    })

    await expect(test.artifacts.discardUncommittedJobArtifacts(
      test.principal,
      'job_foreign_123456',
      [artifact]
    )).rejects.toMatchObject({ code: 'invalid_artifact' })
    await expect(test.artifacts.listOwned(test.principal, test.workspaceId)).resolves.toHaveLength(1)
  })

  it('projects replaced or released media as explicitly unavailable', async () => {
    const test = await fixture()
    const artifact = await test.artifacts.create(test.principal, {
      workspaceId: test.workspaceId,
      mediaHandleId: test.generated.id,
      provenance: { invocationId: 'invocation-1', operation: 'video-render' }
    })
    await writeFile(join(test.workspace, 'exports', 'final.mp4'), Buffer.from('replacement-video'))
    await expect(test.artifacts.getOwned(test.principal, artifact.artifactId))
      .resolves.toMatchObject({ availability: 'unavailable' })
    expect(await test.artifacts.release(test.principal, artifact.artifactId)).toBe(true)
    expect(await test.artifacts.release(test.principal, artifact.artifactId)).toBe(false)
  })
})
