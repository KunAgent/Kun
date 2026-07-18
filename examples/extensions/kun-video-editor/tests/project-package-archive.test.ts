import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildProjectPackageArchivePlan,
  type ProjectPackageArchiveMediaObservation
} from '../src/engine/project-package-archive.js'
import type { MutationReceipt, VideoProject } from '../src/engine/schema.js'
import { makeProject } from './fixtures.js'

const sourceDigest = createHash('sha256').update('shared source').digest('hex')

function projectFixture(): VideoProject {
  const project = makeProject()
  project.assets[0]!.name = '/Users/zxy/private/Interview.mov'
  project.assets[0]!.sourceIdentity = {
    algorithm: 'sha256',
    value: sourceDigest,
    sizeBytes: 2_048
  }
  project.assets[0]!.generatedLineage = {
    providerId: 'local-provider',
    modelId: 'video-model',
    jobId: 'generation-job-1',
    prompt: 'private prompt text',
    referenceAssetIds: []
  }
  project.assets.push({
    ...structuredClone(project.assets[0]!),
    id: 'asset-duplicate',
    name: 'C:\\private\\Duplicate.mov',
    mediaHandleId: 'media_duplicate_123456789',
    generatedLineage: undefined
  })
  const alternate = structuredClone(project.sequences[0]!)
  alternate.id = 'sequence-alternate'
  alternate.name = 'Alternate'
  alternate.items = []
  alternate.captions = []
  project.sequences.push(alternate)
  project.recovery.notes.push('Recovered /Users/zxy/private/project.json')
  return project
}

function observations(): ProjectPackageArchiveMediaObservation[] {
  return [
    {
      assetId: 'asset-1',
      status: 'available',
      handleId: 'media_asset_1',
      displayName: '/Users/zxy/private/Interview.mov',
      mimeType: 'video/quicktime',
      byteSize: 2_048,
      completionIdentity: 'completion-source-1'
    },
    {
      assetId: 'asset-duplicate',
      status: 'available',
      handleId: 'media_duplicate_123456789',
      displayName: 'C:\\private\\Duplicate.mov',
      mimeType: 'video/quicktime',
      byteSize: 2_048,
      completionIdentity: 'completion-source-2'
    }
  ]
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
    attribution: { author: 'agent', actorId: 'kun-agent', sourceOperation: 'video-update-timeline' },
    createdIds: [],
    changedIds: [{ kind: 'item', id: 'item-1' }],
    removedIds: [],
    shifts: [],
    sequenceChanges: ['sequence-main'],
    trackChanges: [],
    proofInvalidated: true,
    notes: [],
    truncated: {
      created: 0,
      changed: 0,
      removed: 0,
      shifts: 0,
      sequenceChanges: 0,
      trackChanges: 0,
      notes: 0
    }
  }
}

describe('project package archive plan', () => {
  it('creates deterministic bounded ZIP entries for all sequences and deduplicated opaque media', () => {
    const options = {
      includeMedia: 'all' as const,
      missingMediaPolicy: 'fail' as const,
      receipts: [receipt()],
      chatProvenance: [{
        threadId: 'thread-1',
        messageId: 'invocation-1',
        role: 'tool' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        contentDigest: createHash('sha256').update('bounded invocation').digest('hex')
      }]
    }
    const first = buildProjectPackageArchivePlan(projectFixture(), observations(), options)
    const second = buildProjectPackageArchivePlan(projectFixture(), observations(), options)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      complete: true,
      selectedAssetCount: 2,
      embeddedAssetCount: 2,
      uniqueMediaCount: 1,
      deduplicatedAssetCount: 1,
      missingAssetIds: [],
      knownInputBytes: 2_048,
      manifest: {
        project: {
          id: 'demo-project',
          sequenceIds: ['sequence-alternate', 'sequence-main'],
          snapshotPath: 'project/project.json'
        },
        provenance: {
          receiptCount: 1,
          chatCount: 1,
          generationLineageCount: 1,
          chatScope: 'bounded-invocation-references'
        },
        deduplication: {
          embeddedAssetCount: 2,
          uniqueMediaCount: 1,
          deduplicatedAssetCount: 1
        }
      }
    })
    expect(first.entries.map(({ archivePath }) => archivePath)).toEqual([
      'manifest/package.json',
      `media/sha256-${sourceDigest}.mov`,
      'project/project.json',
      'provenance/chat.json',
      'provenance/generation-lineage.json',
      'provenance/receipts.json',
      'provenance/revision-ledger.json'
    ])
    expect(first.entries.filter(({ kind }) => kind === 'media')).toEqual([{
      kind: 'media',
      inputHandleId: 'media_asset_1',
      archivePath: `media/sha256-${sourceDigest}.mov`
    }])
    const inline = JSON.stringify(first.entries.filter(({ kind }) => kind === 'inline-text'))
    expect(inline).not.toMatch(/media_asset_1|media_duplicate_123456789/u)
    expect(inline).not.toMatch(/\/Users\/zxy|C:\\private/u)
    expect(inline).not.toContain('private prompt text')
  })

  it('fails closed or records explicit omissions for missing and changed media', () => {
    const project = projectFixture()
    const missing = observations()
    missing[0] = { assetId: 'asset-1', status: 'missing', reason: 'revoked' }

    expect(() => buildProjectPackageArchivePlan(project, missing, {
      includeMedia: 'all', missingMediaPolicy: 'fail'
    })).toThrow(/asset-1 is revoked/u)

    const omitted = buildProjectPackageArchivePlan(project, missing, {
      includeMedia: 'all', missingMediaPolicy: 'omit'
    })
    expect(omitted).toMatchObject({
      complete: false,
      embeddedAssetCount: 1,
      uniqueMediaCount: 1,
      missingAssetIds: ['asset-1'],
      omittedAssetIds: ['asset-1']
    })
    expect(omitted.manifest.missing).toEqual([{
      assetId: 'asset-1', reason: 'revoked', policy: 'omit'
    }])
    expect(omitted.manifest.media).toContainEqual(expect.objectContaining({
      assetId: 'asset-1', status: 'omitted', missingReason: 'revoked'
    }))

    const changed = observations()
    changed[0] = { ...changed[0]!, byteSize: 2_049 }
    expect(() => buildProjectPackageArchivePlan(project, changed, {
      includeMedia: ['asset-1'], missingMediaPolicy: 'fail'
    })).toThrow(/changed after its source identity/u)
  })

  it('does not claim chat history when no bounded invocation reference is supplied', () => {
    const plan = buildProjectPackageArchivePlan(projectFixture(), observations(), {
      includeMedia: [],
      missingMediaPolicy: 'fail'
    })
    expect(plan.manifest.provenance).toMatchObject({
      chatCount: 0,
      chatScope: 'not-requested'
    })
    const chat = plan.entries.find(({ archivePath }) => archivePath === 'provenance/chat.json')
    expect(chat).toMatchObject({ kind: 'inline-text' })
    if (chat?.kind !== 'inline-text') throw new Error('Expected inline chat provenance manifest')
    expect(JSON.parse(chat.content)).toEqual({
      entries: [],
      schemaVersion: 1,
      scope: 'not-requested'
    })
  })
})
