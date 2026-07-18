import { describe, expect, it } from 'vitest'
import {
  VideoEngineError,
  applyTimelineOperations,
  compileRenderIr,
  createMediaFolder,
  deleteMediaFolder,
  generateRenderPlan,
  mediaLibraryPage,
  organizeMediaAssets,
  planBatchMediaImport,
  relinkMediaLibraryAsset,
  updateMediaFolder,
  type MediaAsset
} from '../src/engine/index.js'
import { makeItem, makeProject } from './fixtures.js'

const still: MediaAsset = {
  id: 'asset-still',
  name: 'Cover.png',
  kind: 'image',
  mediaHandleId: 'media_still',
  durationUs: 5_000_000,
  container: 'png',
  still: { width: 1080, height: 1920, format: 'png', animated: false },
  transcriptIds: []
}

const animation: MediaAsset = {
  id: 'asset-animation',
  name: 'Sticker.webp',
  kind: 'animation',
  mediaHandleId: 'media_animation',
  durationUs: 2_000_000,
  container: 'webp',
  still: {
    width: 512,
    height: 512,
    format: 'webp',
    animated: true,
    frameRate: { numerator: 24, denominator: 1 },
    loop: true
  },
  generatedLineage: {
    providerId: 'local-generator',
    modelId: 'image-v1',
    jobId: 'job-animation',
    prompt: 'A small animated sticker',
    referenceAssetIds: ['asset-1'],
    variantOfAssetId: 'asset-1'
  },
  transcriptIds: []
}

describe('richer media library', () => {
  it('organizes folders safely and rejects folder cycles or implicit non-empty deletion', () => {
    let project = makeProject()
    project = createMediaFolder(project, { id: 'folder-root', name: 'Campaign' }).project
    project = createMediaFolder(project, {
      id: 'folder-generated', name: 'Generated', parentId: 'folder-root'
    }).project
    project = planBatchMediaImport(project, [still, animation]).project
    project = organizeMediaAssets(project, ['asset-still', 'asset-animation'], 'folder-generated').project

    expect(project.assets.filter(({ folderId }) => folderId === 'folder-generated').map(({ id }) => id)).toEqual([
      'asset-still', 'asset-animation'
    ])
    expect(() => updateMediaFolder(project, 'folder-root', { parentId: 'folder-generated' })).toThrow(VideoEngineError)
    expect(() => deleteMediaFolder(project, 'folder-generated')).toThrow(VideoEngineError)

    const moved = deleteMediaFolder(project, 'folder-generated', 'folder-root')
    expect(moved.project.mediaFolders?.map(({ id }) => id)).toEqual(['folder-root'])
    expect(moved.project.assets.filter(({ folderId }) => folderId === 'folder-root')).toHaveLength(2)
  })

  it('batch imports still/animation metadata and preserves lineage and organization during relink', () => {
    let project = createMediaFolder(makeProject(), { id: 'folder-generated', name: 'Generated' }).project
    const imported = planBatchMediaImport(project, [
      { ...still, folderId: 'folder-generated' },
      { ...animation, folderId: 'folder-generated' }
    ])
    project = imported.project

    expect(imported.changedAssetIds).toEqual(['asset-animation', 'asset-still'])
    expect(project.assets.find(({ id }) => id === animation.id)).toMatchObject({
      kind: 'animation',
      still: { animated: true, loop: true },
      generatedLineage: { jobId: 'job-animation', referenceAssetIds: ['asset-1'] },
      folderId: 'folder-generated'
    })
    const relinked = relinkMediaLibraryAsset(project, animation.id, {
      mediaHandleId: 'media_animation_relinked',
      availability: 'online',
      sourceIdentity: { algorithm: 'sha256', value: 'a'.repeat(64), sizeBytes: 1_024 }
    }).project
    expect(relinked.assets.find(({ id }) => id === animation.id)).toMatchObject({
      mediaHandleId: 'media_animation_relinked',
      folderId: 'folder-generated',
      generatedLineage: { jobId: 'job-animation' }
    })
    expect(() => planBatchMediaImport(makeProject(), [{ ...animation, still: undefined }])).toThrow(VideoEngineError)
  })

  it('returns bounded virtualized pages and carries still metadata into canonical render IR', () => {
    let project = planBatchMediaImport(makeProject(), [still, animation]).project
    const page = mediaLibraryPage(project, { query: 'e', offset: 1, limit: 1 })
    expect(page).toMatchObject({ offset: 1, limit: 1, total: 3, hiddenBefore: 1, hiddenAfter: 1 })
    expect(page.assets).toHaveLength(1)
    expect(() => mediaLibraryPage(project, { limit: 101 })).toThrow(VideoEngineError)

    const item = {
      ...makeItem('item-still', 0, 0, 2_000_000, 'video-2'),
      assetId: still.id
    }
    project = applyTimelineOperations(project, [{ type: 'add-item', item }]).project
    const ir = compileRenderIr(project)
    expect(ir.sources.find(({ assetId }) => assetId === still.id)?.still).toEqual({
      width: 1080,
      height: 1920,
      format: 'png',
      animated: false,
      loop: false
    })
    expect(ir.layers.find(({ id }) => id === item.id)?.source).toEqual({
      kind: 'asset', sourceId: still.id
    })
    const stillOnly = structuredClone(project)
    stillOnly.items = [structuredClone(item)]
    stillOnly.captions = []
    stillOnly.sequences[0]!.items = structuredClone(stillOnly.items)
    stillOnly.sequences[0]!.captions = []
    const render = generateRenderPlan(stillOnly, {
      kind: 'h264-mp4',
      expectedRevision: stillOnly.currentRevision,
      outputHandleId: 'output_still_video'
    })
    const step = render.steps[0]
    expect(step).toMatchObject({ kind: 'ffmpeg', id: 'h264-mp4' })
    if (step?.kind !== 'ffmpeg') throw new Error('Expected FFmpeg render step')
    expect(step.args).toEqual(expect.arrayContaining(['-loop', '1', '-framerate', '30/1']))
  })
})
