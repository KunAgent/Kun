import { describe, expect, it } from 'vitest'
import { createExtensionTestHarness } from '@kun/extension-test'
import {
  prepareProjectPackageArchiveExport,
  startProjectPackageArchiveExport
} from '../src/host/project-package-export-service.js'
import { makeProject } from './fixtures.js'

const mediaPermissions = [
  'media.read',
  'media.export',
  'jobs.manage',
  'workspace.read',
  'workspace.write'
] as const

describe('project package Host export service', () => {
  it('observes opaque media, prepares a path-free plan, and starts a durable archive job', async () => {
    const harness = createExtensionTestHarness({ permissions: mediaPermissions })
    const project = makeProject()
    project.assets[0]!.mediaHandleId = 'fake_media_project_asset_0001'
    project.assets[0]!.sourceIdentity = {
      algorithm: 'sha256',
      value: 'a'.repeat(64),
      sizeBytes: 2_048
    }
    harness.media.addHandle({
      handleId: project.assets[0]!.mediaHandleId!,
      mode: 'read',
      kind: 'video',
      displayName: 'interview.mp4',
      mimeType: 'video/mp4',
      byteSize: 2_048,
      completionIdentity: 'completion-interview-1'
    })
    const outputHandleId = 'fake_package_output_0001'
    harness.media.addHandle({
      handleId: outputHandleId,
      mode: 'export',
      kind: 'data',
      displayName: 'demo-project.kun-video.zip',
      mimeType: 'application/zip'
    })
    const prepared = await prepareProjectPackageArchiveExport({
      context: harness.context,
      project,
      includeMedia: 'all',
      missingMediaPolicy: 'fail',
      includeChatProvenance: true,
      invocation: {
        invocation: {
          invocationId: 'invocation-package-1',
          toolId: 'video-project-package',
          input: {},
          threadId: 'thread-package-1'
        },
        cancellation: {
          isCancellationRequested: false,
          onCancellationRequested: () => ({ dispose() {} })
        },
        reportProgress() {}
      }
    })
    expect(prepared.plan).toMatchObject({
      complete: true,
      embeddedAssetCount: 1,
      uniqueMediaCount: 1,
      manifest: { provenance: { chatCount: 1 } }
    })

    const job = await startProjectPackageArchiveExport({
      context: harness.context,
      plan: prepared.plan,
      outputHandleId
    })
    expect(job).toMatchObject({ kind: 'media.archive', state: 'queued' })
    const archiveRequest = harness.transport.requests.find(({ method }) =>
      method === 'media.startArchiveJob')
    expect(archiveRequest?.params).toMatchObject({
      format: 'zip',
      outputHandleId,
      idempotencyKey: expect.stringMatching(/^project-package:[a-f0-9]{64}$/u),
      entries: expect.arrayContaining([expect.objectContaining({
        kind: 'media',
        inputHandleId: project.assets[0]!.mediaHandleId,
        archivePath: `media/sha256-${'a'.repeat(64)}.mp4`
      })])
    })
    const publicEntries = (archiveRequest?.params as { entries: unknown[] }).entries
      .filter((entry) => (entry as { kind: string }).kind === 'inline-text')
    expect(JSON.stringify(publicEntries)).not.toContain(project.assets[0]!.mediaHandleId)
    expect(JSON.stringify(publicEntries)).not.toMatch(/\/(?:Users|private|tmp)\//u)
    await harness.dispose()
  })

  it('fails before creating a job when fail policy finds missing media', async () => {
    const harness = createExtensionTestHarness({ permissions: mediaPermissions })
    const project = makeProject()
    project.assets[0]!.availability = 'revoked'
    await expect(prepareProjectPackageArchiveExport({
      context: harness.context,
      project,
      includeMedia: 'all',
      missingMediaPolicy: 'fail',
      includeChatProvenance: false
    })).rejects.toThrow(/asset-1 is revoked/u)
    expect(harness.transport.requests.some(({ method }) => method === 'media.startArchiveJob')).toBe(false)
    await harness.dispose()
  })
})
