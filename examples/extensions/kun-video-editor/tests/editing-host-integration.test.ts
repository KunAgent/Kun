import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonObject, ToolResult } from '@kun/extension-api'
import {
  createExtensionTestHarness,
  type ExtensionTestHarness
} from '@kun/extension-test'
import { afterEach, describe, expect, it } from 'vitest'
import { activate, VIDEO_TOOL_IDS } from '../src/host/extension.js'

const roots: string[] = []
const permissions = [
  'commands.register',
  'ui.views',
  'ui.actions',
  'webview',
  'agent.run',
  'tools.register',
  'storage.workspace',
  'workspace.read',
  'workspace.write',
  'media.read',
  'media.process',
  'media.export',
  'jobs.manage'
]

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('P1 editing Host and Agent integration', () => {
  it('round-trips public sequence, composition, effect, keyframe, retime, and real link-group state', async () => {
    const harness = await projectWithVideo()
    const secondItem = {
      id: 'item-second',
      assetId: 'interview',
      trackId: 'video-1',
      timelineStartFrame: 90,
      durationFrames: 90,
      sourceStartUs: 0,
      sourceEndUs: 3_000_000,
      speed: { numerator: 1, denominator: 1 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0
    }
    const first = await invoke(harness, 'video-update-timeline', {
      projectId: 'host-demo',
      expectedRevision: 1,
      operations: [
        { type: 'create-sequence', sequenceId: 'sequence-alt', name: 'Alternate cut', activate: false },
        {
          type: 'duplicate-sequence', sourceSequenceId: 'sequence-main',
          sequenceId: 'sequence-copy', name: 'Copy', activate: false
        },
        { type: 'rename-sequence', sequenceId: 'sequence-alt', name: 'Social cut' },
        { type: 'set-sequence-view', sequenceId: 'sequence-alt', zoom: 2.5, scrollFrame: 120 },
        { type: 'add-item', item: secondItem },
        {
          type: 'set-link-group',
          group: { id: 'link-real', kind: 'sync', itemIds: ['item-interview', 'item-second'], locked: false }
        }
      ],
      summary: 'Create alternate sequences and a real unlocked link'
    })
    expect(first.content).toMatchObject({ outcome: 'updated', currentRevision: 2 })

    const second = await invoke(harness, 'video-update-timeline', {
      projectId: 'host-demo',
      expectedRevision: 2,
      operations: [
        {
          type: 'set-item-effects', itemId: 'item-interview',
          effects: [{ id: 'blur-main', type: 'blur', enabled: true, parameters: { radius: 4 } }]
        },
        {
          type: 'set-item-keyframes', itemId: 'item-interview',
          keyframes: [{
            id: 'opacity-main', property: 'opacity', interpolation: 'ease',
            points: [
              { id: 'opacity-start', frame: 0, value: 0.4 },
              { id: 'opacity-end', frame: 90, value: 1 }
            ]
          }]
        },
        {
          type: 'update-item-composition', itemId: 'item-interview',
          crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 }, opacity: 0.8, blendMode: 'screen'
        },
        { type: 'retime-item', itemId: 'item-interview', speed: { numerator: 2, denominator: 1 } }
      ],
      summary: 'Apply bounded composition and animation'
    })
    expect(second.content).toMatchObject({ outcome: 'updated', currentRevision: 3 })

    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'host-demo', expectedRevision: 3
    })
    expect(loaded.content).toMatchObject({
      project: {
        schemaVersion: 1,
        sequences: expect.arrayContaining([
          expect.objectContaining({
            id: 'sequence-alt', name: 'Social cut', active: false,
            viewState: { zoom: 2.5, scrollFrame: 120, open: true }, nestedByCount: 0
          }),
          expect.objectContaining({ id: 'sequence-copy', itemCount: 1, captionCount: 0 })
        ]),
        linkGroups: [{ id: 'link-real', kind: 'sync', itemIds: ['item-interview', 'item-second'], locked: false }],
        items: expect.arrayContaining([expect.objectContaining({
          id: 'item-interview', durationFrames: 45, blendMode: 'screen',
          effects: [{ id: 'blur-main', type: 'blur', enabled: true, parameters: { radius: 4 } }],
          keyframes: [expect.objectContaining({ id: 'opacity-main', points: expect.any(Array) })]
        })])
      }
    })

    const durable = JSON.parse(await readFile(projectPath(harness, 'host-demo'), 'utf8'))
    expect(durable.sequences).toHaveLength(3)
    expect(durable.linkGroups[0]).toMatchObject({ id: 'link-real', locked: false })
    expect(JSON.stringify(loaded.content)).not.toMatch(/workspaceRelativePath|\/Users\//u)
    await harness.dispose()
  })

  it('keeps restore-sequence internal and atomically fences stale or invalid external writes', async () => {
    const harness = await projectWithVideo()
    await expect(invoke(harness, 'video-update-timeline', {
      projectId: 'host-demo',
      expectedRevision: 1,
      operations: [{
        type: 'restore-sequence',
        sequence: {
          id: 'injected', name: 'Injected', tracks: [], items: [], captions: [],
          viewState: { zoom: 1, scrollFrame: 0, open: true }
        },
        linkGroups: [],
        activate: false
      }]
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const unchanged = await invoke(harness, 'video-project', { action: 'get', projectId: 'host-demo' })
    expect(unchanged.content).toMatchObject({ project: { currentRevision: 1, counts: { sequences: 1 } } })

    await invoke(harness, 'video-update-timeline', {
      projectId: 'host-demo', expectedRevision: 1,
      operations: [{ type: 'create-sequence', sequenceId: 'safe-alt', name: 'Safe', activate: false }]
    })
    await expect(invoke(harness, 'video-update-timeline', {
      projectId: 'host-demo', expectedRevision: 1,
      operations: [{ type: 'rename-sequence', sequenceId: 'safe-alt', name: 'Stale overwrite' }]
    })).rejects.toMatchObject({ code: 'CONFLICT', details: { currentRevision: 2 } })
    const preserved = await invoke(harness, 'video-project', { action: 'get', projectId: 'host-demo' })
    expect(preserved.content).toMatchObject({
      project: { currentRevision: 2, sequences: expect.arrayContaining([expect.objectContaining({ name: 'Safe' })]) }
    })
    await harness.dispose()
  })

  it('imports still images without timeline insertion and mutates folders through revision-bound commands', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'media-demo', name: 'Media Demo'
    })
    const createdFolder = await editor(harness, 'media.folder.create', {
      projectId: 'media-demo', expectedRevision: 0, folderId: 'folder-campaign', name: 'Campaign'
    })
    expect(createdFolder.content).toMatchObject({ currentRevision: 1, receipt: { newRevision: 1 } })

    const imageHandle = 'fake_media_still_000001'
    harness.media.addHandle(mediaHandle(imageHandle, 'cover.png', 'image'))
    harness.media.setProbe(imageHandle, imageProbe(imageHandle))
    const imported = await editor(harness, 'media.import', {
      projectId: 'media-demo', expectedRevision: 1, mediaHandleId: imageHandle,
      assetId: 'cover-still', assetKind: 'image', folderId: 'folder-campaign',
      stillDurationFrames: 90, addToTimeline: false
    })
    expect(imported.content).toMatchObject({
      outcome: 'imported', currentRevision: 2,
      asset: {
        id: 'cover-still', kind: 'image', folderId: 'folder-campaign',
        still: { width: 1080, height: 1920, animated: false }
      }
    })

    await editor(harness, 'media.folder.create', {
      projectId: 'media-demo', expectedRevision: 2, folderId: 'folder-selected', name: 'Selected'
    })
    const organized = await editor(harness, 'media.organize', {
      projectId: 'media-demo', expectedRevision: 3, assetIds: ['cover-still'], folderId: 'folder-selected'
    })
    expect(organized.content).toMatchObject({ currentRevision: 4, receipt: { newRevision: 4 } })
    await editor(harness, 'media.folder.delete', {
      projectId: 'media-demo', expectedRevision: 4, folderId: 'folder-campaign'
    })
    await editor(harness, 'media.folder.update', {
      projectId: 'media-demo', expectedRevision: 5, folderId: 'folder-selected', name: 'Final', parentId: null
    })

    const loaded = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'media-demo', expectedRevision: 6
    })
    expect(loaded.content).toMatchObject({
      project: {
        counts: { assets: 1, items: 0, mediaFolders: 1 },
        mediaFolders: [{ id: 'folder-selected', name: 'Final' }],
        assets: [{
          id: 'cover-still', kind: 'image', folderId: 'folder-selected', availability: 'online',
          still: { width: 1080, height: 1920, format: 'png', animated: false }
        }]
      }
    })
    const library = await invoke(harness, 'video-inspect', {
      action: 'media-library', projectId: 'media-demo', expectedRevision: 6,
      folderId: 'folder-selected', offset: 0, limit: 10
    })
    expect(library.content).toMatchObject({
      outcome: 'media-library', revision: 6,
      folders: [{ id: 'folder-selected', name: 'Final' }],
      page: {
        offset: 0, limit: 10, total: 1, hiddenBefore: 0, hiddenAfter: 0,
        assets: [expect.objectContaining({ id: 'cover-still', kind: 'image' })]
      }
    })
    const catalog = await invoke(harness, 'video-inspect', { action: 'catalog' })
    expect(catalog.content).toMatchObject({
      outcome: 'catalog',
      catalog: {
        schemaVersion: 1,
        effects: expect.arrayContaining([expect.objectContaining({ type: 'blur' })]),
        blendModes: expect.arrayContaining([{ id: 'screen', labelKey: 'video.blend.screen' }]),
        keyframeProperties: expect.arrayContaining(['opacity', 'volume'])
      }
    })
    expect(JSON.stringify(loaded.content)).not.toMatch(/workspaceRelativePath|\/Users\//u)
    expect(JSON.stringify(library.content)).not.toMatch(/workspaceRelativePath|\/Users\//u)
    await harness.dispose()
  })

  it('keeps a multi-file import at one revision and leaves the project unchanged when one probe fails', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'atomic-media', name: 'Atomic Media'
    })
    const firstHandle = 'fake_media_atomic_first_0001'
    const secondHandle = 'fake_media_atomic_second_001'
    harness.media.addHandle(mediaHandle(firstHandle, 'first.mp4', 'video'))
    harness.media.addHandle(mediaHandle(secondHandle, 'second.mp4', 'video'))
    harness.media.setProbe(firstHandle, videoProbe(firstHandle))

    await expect(editor(harness, 'media.import-batch', {
      projectId: 'atomic-media',
      expectedRevision: 0,
      items: [
        { mediaHandleId: firstHandle, assetId: 'asset-first' },
        { mediaHandleId: secondHandle, assetId: 'asset-second' }
      ],
      addToTimeline: false
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const unchanged = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'atomic-media', expectedRevision: 0
    })
    expect(unchanged.content).toMatchObject({
      project: { currentRevision: 0, counts: { assets: 0, items: 0 } }
    })
    const emptyPage = await editor(harness, 'media.list', {
      projectId: 'atomic-media', expectedRevision: 0, offset: 0, limit: 80
    })
    expect(emptyPage.content).toMatchObject({
      outcome: 'media-library', revision: 0,
      page: { offset: 0, limit: 80, total: 0, assets: [] }
    })
    await harness.dispose()
  })

  it('pages every Host asset beyond the bounded project projection while preserving folders', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'paged-media', name: 'Paged Media'
    })
    await editor(harness, 'media.folder.create', {
      projectId: 'paged-media', expectedRevision: 0,
      folderId: 'folder-archive', name: 'Archive'
    })
    const requests = Array.from({ length: 101 }, (_, index) => {
      const suffix = String(index).padStart(4, '0')
      const handleId = `fake_media_page_${suffix}_0001`
      harness.media.addHandle(mediaHandle(handleId, `asset-${suffix}.png`, 'image'))
      harness.media.setProbe(handleId, imageProbe(handleId))
      return {
        mediaHandleId: handleId,
        assetId: `asset-${suffix}`,
        assetKind: 'image',
        stillDurationFrames: 90
      }
    })
    const first = await editor(harness, 'media.import-batch', {
      projectId: 'paged-media', expectedRevision: 1,
      items: requests.slice(0, 64), folderId: 'folder-archive', addToTimeline: false
    })
    expect(first.content).toMatchObject({
      outcome: 'imported-batch', previousRevision: 1, currentRevision: 2,
      importedCount: 64, receipt: { newRevision: 2 }
    })
    const second = await editor(harness, 'media.import-batch', {
      projectId: 'paged-media', expectedRevision: 2,
      items: requests.slice(64), folderId: 'folder-archive', addToTimeline: false
    })
    expect(second.content).toMatchObject({
      outcome: 'imported-batch', previousRevision: 2, currentRevision: 3,
      importedCount: 37, receipt: { newRevision: 3 }
    })

    const boundedProject = await invoke(harness, 'video-project', {
      action: 'get', projectId: 'paged-media', expectedRevision: 3
    })
    expect(boundedProject.content).toMatchObject({
      truncated: true,
      project: { currentRevision: 3, counts: { assets: 101 }, assets: expect.any(Array) }
    })
    const boundedContent = boundedProject.content as JsonObject
    expect((boundedContent.project as JsonObject).assets).toHaveLength(100)

    const firstPage = await editor(harness, 'media.list', {
      projectId: 'paged-media', expectedRevision: 3,
      folderId: 'folder-archive', offset: 0, limit: 80
    })
    expect(firstPage.content).toMatchObject({
      outcome: 'media-library', revision: 3,
      page: { offset: 0, limit: 80, total: 101, hiddenBefore: 0, hiddenAfter: 21 }
    })
    const lastPage = await editor(harness, 'media.list', {
      projectId: 'paged-media', expectedRevision: 3,
      folderId: 'folder-archive', offset: 80, limit: 80
    })
    expect(lastPage.content).toMatchObject({
      outcome: 'media-library', revision: 3,
      page: {
        offset: 80, limit: 80, total: 101, hiddenBefore: 80, hiddenAfter: 0,
        assets: expect.arrayContaining([
          expect.objectContaining({ id: 'asset-0100', folderId: 'folder-archive' })
        ])
      }
    })
    const lastPageContent = lastPage.content as JsonObject
    expect((lastPageContent.page as JsonObject).assets).toHaveLength(21)
    expect(JSON.stringify(lastPage.content)).not.toMatch(/workspaceRelativePath|\/Users\//u)
    await harness.dispose()
  })

  it('persists bounded preview history and exposes a path-free selection attachment to View and Agent', async () => {
    const harness = await projectWithVideo()
    await editor(harness, 'context.update', {
      projectId: 'host-demo', expectedRevision: 1, expectedGeneration: 0,
      playheadFrame: 30, selectedAssetIds: ['interview'], selectedItemIds: ['item-interview'],
      selectedCaptionIds: [], selectedWordIds: [], range: { startFrame: 15, endFrame: 45 }
    })
    const added = await editor(harness, 'preview.add', {
      projectId: 'host-demo', expectedRevision: 1, entryId: 'preview-source', label: 'Source range',
      source: { kind: 'asset', assetId: 'interview', startUs: 0, endUs: 1_000_000 }
    })
    expect(added.content).toMatchObject({
      history: { schemaVersion: 1, generation: 1, activeEntryId: 'preview-source' }
    })
    await editor(harness, 'preview.add', {
      projectId: 'host-demo', expectedRevision: 1, entryId: 'preview-proof', label: 'Current proof',
      source: {
        kind: 'timeline', sequenceId: 'sequence-main', revision: 1,
        startFrame: 0, endFrame: 90, artifactId: 'proof-current'
      }
    })
    const compared = await editor(harness, 'preview.compare', {
      projectId: 'host-demo', expectedRevision: 1,
      leftEntryId: 'preview-source', rightEntryId: 'preview-proof', mode: 'side-by-side'
    })
    expect(compared.content).toMatchObject({
      comparison: { mode: 'side-by-side', sameRevision: false }
    })

    const attached = await editor(harness, 'context.attach-selection', {
      projectId: 'host-demo', expectedRevision: 1, previewEntryIds: ['preview-source', 'preview-proof']
    })
    expect(attached.content).toMatchObject({
      attachment: {
        schemaVersion: 1, projectId: 'host-demo', sequenceId: 'sequence-main', revision: 1,
        selectionGeneration: 1, playheadFrame: 30, selectedItemIds: ['item-interview'],
        range: { startFrame: 15, endFrame: 45 },
        previewEntryIds: ['preview-source', 'preview-proof']
      }
    })
    const agentAttachment = await invoke(harness, 'video-inspect', {
      action: 'selection-attachment', projectId: 'host-demo', expectedRevision: 1,
      previewEntryIds: ['preview-source']
    })
    expect(agentAttachment.content).toMatchObject({
      outcome: 'selection-attachment', attachment: { previewEntryIds: ['preview-source'] }
    })
    expect(JSON.stringify(attached.content)).not.toMatch(/mediaHandleId|workspaceRelativePath|\/Users\//u)

    const projected = await invoke(harness, 'video-project', { action: 'get', projectId: 'host-demo' })
    expect(projected.content).toMatchObject({
      project: {
        previewHistory: { generation: 2, activeEntryId: 'preview-proof' },
        selectionAttachment: { revision: 1, previewEntryIds: ['preview-proof'] }
      }
    })
    const replaced = await editor(harness, 'preview.replace', {
      projectId: 'host-demo', expectedRevision: 1, itemId: 'item-interview', entryId: 'preview-source'
    })
    expect(replaced.content).toMatchObject({ currentRevision: 2, receipt: { newRevision: 2 } })
    await expect(editor(harness, 'preview.replace', {
      projectId: 'host-demo', expectedRevision: 1, itemId: 'item-interview', entryId: 'preview-source'
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    await harness.dispose()
  })

  it('reports nesting parents and decomposes a neutral nested sequence as one manual transaction', async () => {
    const harness = await projectWithVideo()
    const nestedItem = {
      id: 'nested-cut', assetId: 'sequence-child', nestedSequenceId: 'sequence-child',
      trackId: 'video-1', timelineStartFrame: 90, durationFrames: 90,
      sourceStartUs: 0, sourceEndUs: 3_000_000,
      speed: { numerator: 1, denominator: 1 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1, fadeInFrames: 0, fadeOutFrames: 0
    }
    await invoke(harness, 'video-update-timeline', {
      projectId: 'host-demo', expectedRevision: 1,
      operations: [
        {
          type: 'duplicate-sequence', sourceSequenceId: 'sequence-main',
          sequenceId: 'sequence-child', name: 'Child', activate: false
        },
        { type: 'add-item', item: nestedItem }
      ]
    })
    const before = await invoke(harness, 'video-project', { action: 'get', projectId: 'host-demo' })
    expect(before.content).toMatchObject({
      project: { sequences: expect.arrayContaining([expect.objectContaining({ id: 'sequence-child', nestedByCount: 1 })]) }
    })
    const decomposed = await editor(harness, 'sequence.decompose', {
      projectId: 'host-demo', expectedRevision: 2, itemId: 'nested-cut'
    })
    expect(decomposed.content).toMatchObject({
      outcome: 'sequence-decomposed', previousRevision: 2, currentRevision: 3,
      nestedSequenceId: 'sequence-child', receipt: { newRevision: 3 }
    })
    const durable = JSON.parse(await readFile(projectPath(harness, 'host-demo'), 'utf8'))
    expect(durable.items.some(({ id }: { id: string }) => id === 'nested-cut')).toBe(false)
    expect(durable.items.some(({ id }: { id: string }) => id.startsWith('nested-cut~decomposed-'))).toBe(true)
    await harness.dispose()
  })

  it('connects the right-sidebar multicam workflow to Agent inspection, transactions, and ranged rendering', async () => {
    const harness = await activatedHarness()
    await invoke(harness, 'video-project', {
      action: 'create', projectId: 'multicam-host', name: 'Multicam Host'
    })
    for (const [index, assetId] of ['camera-wide', 'camera-close'].entries()) {
      const handleId = `fake_media_multicam_${index}_0001`
      harness.media.addHandle(mediaHandle(handleId, `${assetId}.mp4`, 'video'))
      harness.media.setProbe(handleId, videoProbe(handleId))
      await invoke(harness, 'video-probe', {
        projectId: 'multicam-host', expectedRevision: index,
        mediaHandleId: handleId, assetId, addToTimeline: false
      })
    }

    const created = await editor(harness, 'multicam.create', {
      projectId: 'multicam-host', expectedRevision: 2,
      groupId: 'interview-cameras', sequenceId: 'sequence-main', name: 'Interview cameras',
      referenceMemberId: 'angle-wide', createDefaultLayout: true,
      members: [
        { id: 'angle-wide', assetId: 'camera-wide', memberLabel: 'Wide camera', angleLabel: 'Wide' },
        { id: 'angle-close', assetId: 'camera-close', memberLabel: 'Close camera', angleLabel: 'Close' }
      ]
    })
    expect(created.content).toMatchObject({
      outcome: 'create', previousRevision: 2, currentRevision: 3,
      receipt: { newRevision: 3, proofInvalidated: true }
    })

    const unknown = await invoke(harness, 'video-inspect', {
      action: 'multicam', projectId: 'multicam-host', expectedRevision: 3,
      groupId: 'interview-cameras'
    })
    expect(unknown.content).toMatchObject({ outcome: 'multicam', renderReady: true })
    const inspectedGroup = (unknown.content as JsonObject).group as JsonObject
    const inspectedMembers = inspectedGroup.members as JsonObject[]
    expect(inspectedMembers.find(({ id }) => id === 'angle-close')).toMatchObject({
      id: 'angle-close', sync: { status: 'unknown', offsetFrames: 0 }
    })
    const forgedSyncGroup = structuredClone(inspectedGroup)
    const forgedClose = (forgedSyncGroup.members as JsonObject[])
      .find(({ id }) => id === 'angle-close')!
    forgedClose.sync = {
      status: 'verified', offsetFrames: 0, confidence: 1,
      evidence: [{
        id: 'invented-sync', analysisId: 'invented-analysis', kind: 'manual-confirmation',
        referenceMemberId: 'angle-wide', targetMemberId: 'angle-close', confidence: 1,
        algorithmId: 'invented', algorithmVersion: '1'
      }]
    }
    await expect(invoke(harness, 'video-update-timeline', {
      projectId: 'multicam-host', expectedRevision: 3,
      operations: [{ type: 'set-multicam-group', group: forgedSyncGroup }]
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const forgedCoverageGroup = structuredClone(inspectedGroup)
    const forgedReference = (forgedCoverageGroup.members as JsonObject[])
      .find(({ id }) => id === 'angle-wide')!
    ;((forgedReference.coverage as JsonObject[])[0]!).sourceEndFrame = 900
    await expect(invoke(harness, 'video-update-timeline', {
      projectId: 'multicam-host', expectedRevision: 3,
      operations: [{ type: 'set-multicam-group', group: forgedCoverageGroup }]
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    await editor(harness, 'multicam.sync-confirm', {
      projectId: 'multicam-host', expectedRevision: 3,
      groupId: 'interview-cameras', memberId: 'angle-close', offsetFrames: 0,
      status: 'verified', confidence: 0.93
    })
    const switched = await invoke(harness, 'video-update-timeline', {
      projectId: 'multicam-host', expectedRevision: 4,
      operations: [{
        type: 'switch-multicam-angle', groupId: 'interview-cameras', memberId: 'angle-close',
        startFrame: 30, endFrame: 60, coveragePolicy: 'reject', minimumSyncConfidence: 0.9
      }],
      summary: 'Switch to close camera'
    })
    expect(switched.content).toMatchObject({
      outcome: 'updated', currentRevision: 5,
      receipt: { proofInvalidated: true }
    })
    await expect(editor(harness, 'multicam.merge', {
      projectId: 'multicam-host', expectedRevision: 4, groupId: 'interview-cameras'
    })).rejects.toMatchObject({ code: 'CONFLICT' })

    const outputHandleId = 'fake_multicam_render_output_0001'
    harness.media.addHandle({
      handleId: outputHandleId,
      mode: 'export',
      kind: 'video',
      displayName: 'multicam-preview.mp4',
      mimeType: 'video/mp4',
      byteSize: 0
    })
    const rendered = await invoke(harness, 'video-render', {
      projectId: 'multicam-host', expectedRevision: 5, kind: 'preview',
      multicamGroupId: 'interview-cameras', startFrame: 30, endFrame: 60,
      outputHandleId, captionMode: 'none'
    })
    expect(rendered.content).toMatchObject({
      outcome: 'queued', projectId: 'multicam-host', multicamGroupId: 'interview-cameras',
      pinnedRevision: 5, renderRange: { startFrame: 30, endFrame: 60 }
    })
    const renderRequest = harness.transport.requests
      .filter(({ method }) => method === 'media.startFfmpegJob')
      .at(-1)?.params as JsonObject
    expect(renderRequest).toMatchObject({
      inputs: {
        'clip-0': 'fake_media_multicam_1_0001'
      },
      metadata: {
        projectId: 'multicam-host', multicamGroupId: 'interview-cameras',
        pinnedRevision: 5, renderRange: { startFrame: 30, endFrame: 60 }
      }
    })
    expect(JSON.stringify({ unknown, switched, rendered, renderRequest }))
      .not.toMatch(/(?:\/Users\/|file:\/\/|workspaceRelativePath|rawPath)/u)
    await harness.dispose()
  })
})

async function activatedHarness(): Promise<ExtensionTestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'kun-video-editing-host-'))
  roots.push(root)
  const harness = createExtensionTestHarness({
    identity: {
      id: 'kun-examples.kun-video-editor',
      publisher: 'kun-examples',
      name: 'kun-video-editor',
      version: '0.4.0'
    },
    permissions,
    workspace: { id: 'video-workspace', name: 'Video Workspace', root, trusted: true, active: true }
  })
  await harness.activate(activate)
  return harness
}

async function projectWithVideo(): Promise<ExtensionTestHarness> {
  const harness = await activatedHarness()
  await invoke(harness, 'video-project', {
    action: 'create', projectId: 'host-demo', name: 'Host Demo'
  })
  const handleId = 'fake_media_source_0001'
  harness.media.addHandle(mediaHandle(handleId, 'interview.mp4', 'video'))
  harness.media.setProbe(handleId, videoProbe(handleId))
  await invoke(harness, 'video-probe', {
    projectId: 'host-demo', expectedRevision: 0, mediaHandleId: handleId, assetId: 'interview'
  })
  return harness
}

async function invoke(
  harness: ExtensionTestHarness,
  id: (typeof VIDEO_TOOL_IDS)[number],
  input: JsonObject
): Promise<ToolResult> {
  const registration = [...harness.tools.registrations]
    .find(([, declaration]) => declaration.id === id)?.[0]
  if (!registration) throw new Error(`Tool ${id} was not registered`)
  return await harness.tools.invoke(registration, input) as ToolResult
}

async function editor(harness: ExtensionTestHarness, action: string, payload: JsonObject): Promise<ToolResult> {
  return await harness.client.commands.executeCommand<ToolResult>('editor-request', { action, payload })
}

function projectPath(harness: ExtensionTestHarness, projectId: string): string {
  return join(harness.context.workspaceContext!.root, '.kun-video', 'projects', projectId, 'project.json')
}

function mediaHandle(handleId: string, displayName: string, kind: 'video' | 'image'): JsonObject {
  return {
    handleId,
    mode: 'read',
    kind,
    displayName,
    mimeType: kind === 'video' ? 'video/mp4' : 'image/png',
    byteSize: 4096
  }
}

function videoProbe(handleId: string): JsonObject {
  return {
    schemaVersion: 1,
    handleId,
    container: { formatNames: ['mp4'], durationMicros: 3_000_000 },
    streams: [
      {
        index: 0, kind: 'video', codecName: 'h264', durationMicros: 3_000_000,
        frameRate: { numerator: 30, denominator: 1 }, width: 1920, height: 1080,
        disposition: { default: true }
      },
      {
        index: 1, kind: 'audio', codecName: 'aac', durationMicros: 3_000_000,
        sampleRate: 48_000, channelCount: 2, disposition: { default: true }
      }
    ]
  }
}

function imageProbe(handleId: string): JsonObject {
  return {
    schemaVersion: 1,
    handleId,
    container: { formatNames: ['png'] },
    streams: [{
      index: 0, kind: 'video', codecName: 'png',
      frameRate: { numerator: 25, denominator: 1 }, width: 1080, height: 1920,
      disposition: { default: true }
    }]
  }
}
