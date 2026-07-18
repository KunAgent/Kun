import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildSelfContainedProjectPackage,
  commitStagedProjectPackageExport,
  createProjectPackageJob,
  parseSelfContainedProjectPackage,
  reconcileInterruptedProjectPackageJob,
  retryInterruptedProjectPackageJob,
  stageProjectPackageExport,
  type AtomicPackageSink,
  type AtomicPackageTransaction,
  type BuiltProjectPackage,
  type ProjectPackageMediaResolver
} from '../src/engine/project-package.js'
import type { MutationReceipt, VideoProject } from '../src/engine/schema.js'
import { makeProject } from './fixtures.js'

const mediaBytes = Buffer.from('same-media-payload-for-deduplication')
const mediaDigest = createHash('sha256').update(mediaBytes).digest('hex')
const contentDigest = createHash('sha256').update('chat content').digest('hex')
const promptDigest = createHash('sha256').update('generation prompt').digest('hex')

function packagedProject(): VideoProject {
  const project = makeProject()
  project.assets[0]!.sourceIdentity = {
    algorithm: 'sha256', value: mediaDigest, sizeBytes: mediaBytes.byteLength
  }
  project.assets.push({
    ...structuredClone(project.assets[0]!),
    id: 'asset-duplicate',
    name: 'Duplicate.mov',
    mediaHandleId: 'media_asset_duplicate',
    transcriptIds: []
  })
  const alternate = structuredClone(project.sequences[0]!)
  alternate.id = 'sequence-alternate'
  alternate.name = 'Alternate cut'
  alternate.items = alternate.items.map((item, index) => ({ ...item, id: `alternate-item-${index + 1}` }))
  alternate.captions = alternate.captions.map((caption, index) => ({ ...caption, id: `alternate-caption-${index + 1}` }))
  project.sequences.push(alternate)
  project.recovery.notes.push('Recovered from /Users/zxy/private/project.json')
  return project
}

function receipt(): MutationReceipt {
  return {
    schemaVersion: 1,
    transactionId: 'transaction-1',
    projectId: 'demo-project',
    sequenceId: 'sequence-main',
    previousRevision: 0,
    newRevision: 1,
    generation: 1,
    attribution: { author: 'agent', actorId: 'kun-agent', sourceOperation: 'video-edit' },
    createdIds: [],
    changedIds: [{ kind: 'item', id: 'item-1' }],
    removedIds: [],
    shifts: [],
    sequenceChanges: ['sequence-main'],
    trackChanges: [],
    proofInvalidated: true,
    notes: [{
      code: 'edited',
      messageKey: 'video.receipt.edited',
      severity: 'info',
      values: { diagnostic: '/Users/zxy/private/source.mov' }
    }],
    truncated: {
      created: 0, changed: 0, removed: 0, shifts: 0,
      sequenceChanges: 0, trackChanges: 0, notes: 0
    }
  }
}

function resolver(): ProjectPackageMediaResolver {
  return async ({ assetId }) => ({
    status: 'available',
    bytes: mediaBytes,
    logicalName: assetId === 'asset-1' ? '/Users/zxy/private/Interview.mov' : 'C:\\private\\Duplicate.mov',
    mime: 'video/quicktime'
  })
}

async function builtPackage(project = packagedProject()): Promise<BuiltProjectPackage> {
  return await buildSelfContainedProjectPackage(project, {
    includeMedia: 'all',
    missingMediaPolicy: 'fail',
    receipts: [receipt()],
    chatProvenance: [{
      threadId: 'thread-1',
      messageId: 'message-1',
      role: 'assistant',
      createdAt: '2026-01-01T00:00:00.000Z',
      contentDigest
    }],
    generationLineage: [{
      assetId: 'asset-duplicate',
      jobId: 'generation-job-1',
      providerId: 'local-provider',
      modelId: 'video-model-1',
      promptDigest,
      referenceAssetIds: ['asset-1']
    }]
  }, resolver())
}

class MemoryAtomicSink implements AtomicPackageSink {
  readonly staged = new Map<string, Uint8Array>()
  readonly promoted = new Map<string, Uint8Array>()
  readonly committedDigests = new Map<string, string>()
  abortOnWrite?: () => void

  async begin(request: {
    targetHandle: string
    jobId: string
    attempt: number
    idempotencyKey: string
    packageDigest: string
    bytes: number
  }): Promise<AtomicPackageTransaction> {
    const stagingId = `${request.jobId}.attempt-${request.attempt}.staging`
    return {
      stagingId,
      write: async (bytes, signal) => {
        this.abortOnWrite?.()
        if (signal.aborted) throw new Error('cancelled during staging')
        this.staged.set(stagingId, Uint8Array.from(bytes))
      },
      commit: async (signal) => {
        if (signal.aborted) throw new Error('cancelled before commit')
        const bytes = this.staged.get(stagingId)
        if (!bytes) throw new Error('staging payload is missing')
        this.promoted.set(request.targetHandle, bytes)
        this.committedDigests.set(request.targetHandle, request.packageDigest)
        this.staged.delete(stagingId)
      },
      rollback: async () => {
        this.staged.delete(stagingId)
      }
    }
  }

  async rollbackStaging(stagingId: string): Promise<void> {
    this.staged.delete(stagingId)
  }

  async committedDigest(request: { targetHandle: string }): Promise<string | undefined> {
    return this.committedDigests.get(request.targetHandle)
  }
}

function job(targetHandle: string) {
  return createProjectPackageJob({
    extensionId: 'kun-examples.kun-video-editor',
    extensionVersion: '0.4.0',
    workspaceId: 'workspace-1',
    projectId: 'demo-project',
    sequenceId: 'sequence-main',
    revision: 0,
    idempotencyKey: `package-${targetHandle}`,
    targetHandle
  })
}

describe('self-contained project package', () => {
  it('snapshots every sequence/schema and optional provenance while deduplicating media without source paths', async () => {
    const first = await builtPackage()
    const second = await builtPackage()
    expect(first).toMatchObject({
      complete: true,
      embeddedAssetCount: 2,
      uniqueObjectCount: 1,
      deduplicatedAssetCount: 1,
      missingAssetIds: []
    })
    expect(Buffer.from(first.bytes)).toEqual(Buffer.from(second.bytes))
    expect(first.package.project).toMatchObject({
      id: 'demo-project',
      schemaVersion: 2,
      revision: 0,
      activeSequenceId: 'sequence-main',
      sequenceIds: ['sequence-alternate', 'sequence-main']
    })
    expect(first.package.project.snapshot.sequences).toHaveLength(2)
    expect(first.package.mediaManifest).toEqual([
      expect.objectContaining({ assetId: 'asset-1', status: 'embedded', objectId: `sha256-${mediaDigest}` }),
      expect.objectContaining({ assetId: 'asset-duplicate', status: 'embedded', objectId: `sha256-${mediaDigest}` })
    ])
    expect(first.package.provenance).toMatchObject({
      receiptsIncluded: true,
      chatIncluded: true,
      receipts: [expect.objectContaining({ transactionId: 'transaction-1' })],
      chat: [expect.objectContaining({ messageId: 'message-1', contentDigest })],
      generationLineage: [expect.objectContaining({ assetId: 'asset-duplicate', promptDigest })]
    })
    expect(first.package.provenance.redactedPathValues).toBeGreaterThanOrEqual(2)
    expect(first.package.project.snapshot.assets).toEqual([
      expect.objectContaining({ mediaHandleId: 'package_offline_asset-1', availability: 'offline' }),
      expect.objectContaining({ mediaHandleId: 'package_offline_asset-duplicate', availability: 'offline' })
    ])
    const withoutPayloads = JSON.stringify({
      ...first.package,
      objects: first.package.objects.map(({ dataBase64: _dataBase64, ...metadata }) => metadata)
    })
    expect(withoutPayloads).not.toMatch(/\/Users\/zxy|C:\\private/u)
    expect(withoutPayloads).not.toContain('media_asset_1')
    expect(withoutPayloads).not.toContain('media_asset_duplicate')

    const parsed = parseSelfContainedProjectPackage(first.bytes)
    expect(parsed.integrity.value).toBe(first.digest)
    expect(parsed.objects[0]).toMatchObject({ sha256: mediaDigest, bytes: mediaBytes.byteLength })
  })

  it('honors fail vs explicitly incomplete missing-media policies without exposing paths', async () => {
    const missing: ProjectPackageMediaResolver = async () => ({ status: 'missing', reason: 'offline' })
    const project = makeProject()
    await expect(buildSelfContainedProjectPackage(project, {
      includeMedia: 'all', missingMediaPolicy: 'fail'
    }, missing)).rejects.toThrowError(/media asset-1: offline/u)

    const incomplete = await buildSelfContainedProjectPackage(project, {
      includeMedia: 'all', missingMediaPolicy: 'record-incomplete'
    }, missing)
    expect(incomplete).toMatchObject({ complete: false, missingAssetIds: ['asset-1'] })
    expect(incomplete.package.missingMedia).toEqual([{ assetId: 'asset-1', reason: 'offline' }])
    expect(incomplete.package.mediaManifest).toEqual([
      expect.objectContaining({ assetId: 'asset-1', status: 'missing', missingReason: 'offline' })
    ])
    expect(JSON.stringify(incomplete.package)).not.toContain('/Users/')
  })

  it('verifies package and embedded media integrity on import', async () => {
    const built = await builtPackage()
    const tampered = structuredClone(built.package)
    tampered.objects[0]!.dataBase64 = Buffer.from('tampered').toString('base64')
    expect(() => parseSelfContainedProjectPackage(tampered)).toThrowError(/integrity/u)
  })

  it('promotes atomically only after staging and rolls back cancellation', async () => {
    const built = await builtPackage()
    const sink = new MemoryAtomicSink()
    const controller = new AbortController()
    const staged = await stageProjectPackageExport(job('package_target_1'), built, sink, controller.signal)
    expect(staged.record).toMatchObject({ state: 'staged', progress: 0.9, packageDigest: built.digest })
    expect(sink.promoted.size).toBe(0)
    expect(sink.staged.size).toBe(1)

    const completed = await commitStagedProjectPackageExport(staged, controller.signal)
    expect(completed).toMatchObject({ state: 'completed', progress: 1, completedDigest: built.digest })
    expect(sink.staged.size).toBe(0)
    expect(Buffer.from(sink.promoted.get('package_target_1')!)).toEqual(Buffer.from(built.bytes))

    const cancelledSink = new MemoryAtomicSink()
    const cancelled = new AbortController()
    cancelledSink.abortOnWrite = () => cancelled.abort()
    await expect(stageProjectPackageExport(job('package_target_cancel'), built, cancelledSink, cancelled.signal))
      .rejects.toThrowError(/cancel/u)
    expect(cancelledSink.staged.size).toBe(0)
    expect(cancelledSink.promoted.size).toBe(0)
  })

  it('reconciles restart staging as interrupted and retries the same idempotent job safely', async () => {
    const built = await builtPackage()
    const sink = new MemoryAtomicSink()
    const signal = new AbortController().signal
    const initial = job('package_target_restart')
    const staged = await stageProjectPackageExport(initial, built, sink, signal)
    const staleStagingId = staged.record.stagingId!
    expect(sink.staged.has(staleStagingId)).toBe(true)

    const interrupted = await reconcileInterruptedProjectPackageJob(staged.record, sink)
    expect(interrupted).toMatchObject({
      jobId: initial.jobId,
      idempotencyKey: initial.idempotencyKey,
      state: 'interrupted',
      progress: 0,
      errorCode: 'process-interrupted-by-restart'
    })
    expect(sink.staged.has(staleStagingId)).toBe(false)
    expect(sink.promoted.size).toBe(0)

    const retried = retryInterruptedProjectPackageJob(interrupted)
    expect(retried).toMatchObject({ jobId: initial.jobId, attempt: 2, state: 'queued' })
    const restaged = await stageProjectPackageExport(retried, built, sink, signal)
    const completed = await commitStagedProjectPackageExport(restaged, signal)
    expect(completed).toMatchObject({ state: 'completed', attempt: 2, completedDigest: built.digest })
    expect(sink.promoted.get('package_target_restart')).toBeDefined()
  })

  it('reconciles a lost commit acknowledgement as completed by digest instead of duplicating output', async () => {
    const built = await builtPackage()
    const sink = new MemoryAtomicSink()
    const signal = new AbortController().signal
    const staged = await stageProjectPackageExport(job('package_target_ack_lost'), built, sink, signal)

    // Simulate atomic promotion succeeding immediately before the process dies,
    // so only the durable staged record survives.
    await staged.transaction.commit(signal)
    expect(sink.promoted.get('package_target_ack_lost')).toBeDefined()
    const reconciled = await reconcileInterruptedProjectPackageJob(staged.record, sink)

    expect(reconciled).toMatchObject({
      state: 'completed',
      completedDigest: built.digest,
      idempotencyKey: staged.record.idempotencyKey
    })
    expect(sink.promoted.size).toBe(1)
  })
})
