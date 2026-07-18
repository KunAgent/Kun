import { describe, expect, it } from 'vitest'
import {
  inspectComposedTimeline,
  inspectRawMedia,
  readCompactProjectWindow,
  resolveProjectContext
} from '../src/engine/inspection.js'
import {
  defaultFfmpegCapabilities,
  renderCapabilitiesDigest
} from '../src/engine/render-ir.js'
import { makeItem, makeProject } from './fixtures.js'

describe('bounded Agent inspection', () => {
  it('reads one compact window, omits defaults, summarizes captions, and reports gaps and hidden counts', () => {
    const project = makeProject()
    const result = readCompactProjectWindow(project, {
      startFrame: 0,
      endFrame: 180,
      itemLimit: 1,
      captionLimit: 1
    })

    expect(result).toMatchObject({
      projectId: project.id,
      revision: 0,
      sequence: { id: 'sequence-main', durationFrames: 180 },
      captionSummary: { visible: 1, returned: 1, hidden: 0 },
      hiddenCounts: { itemsInWindow: 1 }
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).not.toHaveProperty('transform')
    expect(result.items[0]).not.toHaveProperty('opacity')
    expect(result.items[0]).not.toHaveProperty('speed')
    expect(result.captions[0]).not.toHaveProperty('text')
    expect(result.gaps).toContainEqual({ trackId: 'video-2', startFrame: 0, endFrame: 180 })
    expect(result.gaps).toContainEqual({ trackId: 'captions-1', startFrame: 45, endFrame: 180 })
  })

  it('pages raw transcript evidence, bounds words, and never claims visual understanding', () => {
    const project = makeProject()
    project.assets[0]!.availability = 'changed'
    project.derivedReferences.push(
      {
        id: 'filmstrip-ready',
        kind: 'filmstrip',
        sourceAssetId: 'asset-1',
        dependencyIds: [],
        producerVersion: '1.0.0',
        status: 'ready',
        bytes: 200,
        pinned: false,
        updatedAt: project.updatedAt
      },
      {
        id: 'analysis-pending',
        kind: 'analysis',
        sourceAssetId: 'asset-1',
        dependencyIds: [],
        producerVersion: '1.0.0',
        status: 'processing',
        bytes: 0,
        pinned: false,
        updatedAt: project.updatedAt
      }
    )

    const result = inspectRawMedia(project, {
      assetId: 'asset-1',
      segmentOffset: 1,
      segmentLimit: 2,
      includeWords: true,
      sampleFrames: [0, 30, 30]
    })

    expect(result.asset.availability).toBe('changed')
    expect(result.transcript).toMatchObject({
      offset: 1,
      returned: 2,
      total: 4,
      hiddenBefore: 1,
      hiddenAfter: 1
    })
    expect(result.samples).toHaveLength(2)
    expect(result.samples[1]).toMatchObject({ frame: 30, frameLabel: '00:00:01:00', status: 'ready' })
    expect(result.capability).toEqual({
      timedTranscript: 'ready',
      wordTimestamps: 'ready',
      sampledFrames: 'ready',
      visualUnderstanding: 'not-claimed'
    })
  })

  it('resolves revision- and generation-bound selection without a DOM dependency', () => {
    const project = makeProject()
    project.selection = {
      generation: 4,
      revision: 0,
      sequenceId: project.activeSequenceId,
      playheadFrame: 12,
      selectedAssetIds: ['asset-1'],
      selectedItemIds: ['item-1'],
      selectedCaptionIds: [],
      selectedWordIds: ['word-1'],
      range: { startFrame: 10, endFrame: 20 }
    }

    expect(resolveProjectContext(project, { expectedRevision: 0, expectedGeneration: 4 })).toMatchObject({
      status: 'current',
      generation: 4,
      selectedItemIds: ['item-1'],
      range: { startFrame: 10, endFrame: 20 }
    })
    expect(resolveProjectContext(project, { expectedGeneration: 3 })).toMatchObject({
      status: 'stale',
      staleReason: 'generation'
    })
    project.currentRevision = 1
    expect(resolveProjectContext(project)).toMatchObject({
      status: 'stale',
      staleReason: 'revision'
    })
  })

  it('inspects the composed frame and accepts only a revision-, IR-, and capability-bound proof', () => {
    const project = makeProject()
    const item = {
      ...makeItem('picture-in-picture', 0, 0, 3_000_000, 'video-2'),
      transform: { x: 0.5, y: -0.25, scaleX: 0.4, scaleY: 0.4, rotation: 0 },
      opacity: 0.8,
      effects: [{ id: 'fx-color', type: 'color', enabled: true, parameters: { saturation: 0.9 } }],
      keyframes: [{
        id: 'kf-position-x',
        property: 'transform.x',
        interpolation: 'linear' as const,
        points: [
          { id: 'kf-1', frame: 0, value: 0.2 },
          { id: 'kf-2', frame: 30, value: 0.5 }
        ]
      }]
    }
    project.items.push(item)
    project.sequences[0]!.items.push(structuredClone(item))
    const capabilities = defaultFfmpegCapabilities()
    const initial = inspectComposedTimeline(project, 10, capabilities)
    const current = inspectComposedTimeline(project, 10, capabilities, [{
      id: 'proof-current',
      kind: 'proof',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      revision: project.currentRevision,
      irDigest: initial.irDigest,
      capabilitiesDigest: renderCapabilitiesDigest(capabilities),
      frame: 10,
      status: 'ready'
    }, {
      id: 'proof-old',
      kind: 'proof',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      revision: project.currentRevision - 1,
      irDigest: initial.irDigest,
      capabilitiesDigest: renderCapabilitiesDigest(capabilities),
      frame: 10,
      status: 'ready'
    }])

    expect(current.proofStatus).toBe('current')
    expect(current.frameLabel).toBe('00:00:00:10')
    expect(current.irDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(current.visibleMediaLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: 'picture-in-picture',
        opacity: 0.8,
        effects: ['fx-color'],
        keyframeTracks: ['kf-position-x'],
        transform: expect.objectContaining({ x: 0.5, scaleX: 0.4 })
      })
    ]))
    expect(current.visibleTextLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ captionId: 'caption-1', trackId: 'captions-1' })
    ]))
    expect(current.proofArtifacts).toEqual([
      expect.objectContaining({ id: 'proof-current', current: true }),
      expect.objectContaining({ id: 'proof-old', current: false })
    ])
  })
})
