import { describe, expect, it } from 'vitest'
import {
  exportProjectToOtio,
  frameTimecode,
  importProjectFromOtio,
  serializeOtioInterchange
} from '../src/engine/otio-interchange.js'
import type { Sequence, VideoProject } from '../src/engine/schema.js'
import { makeItem, makeProject } from './fixtures.js'

function complexProject(): VideoProject {
  const project = makeProject()
  const alternate: Sequence = {
    id: 'sequence-alternate',
    name: 'Alternate cut',
    tracks: structuredClone(project.tracks),
    items: [{
      ...makeItem('alternate-item', 0, 0, 1_000_000),
      effects: [{ id: 'alternate-vignette', type: 'vignette', enabled: true, parameters: { intensity: 0.25 } }]
    }],
    captions: [],
    viewState: { zoom: 1.5, scrollFrame: 12, open: true }
  }
  const main = project.sequences[0]!
  main.items[0] = {
    ...main.items[0]!,
    transform: { x: 0.1, y: -0.1, scaleX: 0.8, scaleY: 0.8, rotation: 3 },
    crop: { left: 0.05, top: 0.02, right: 0.05, bottom: 0.02 },
    opacity: 0.9,
    effects: [{ id: 'color-main', type: 'color.basic', enabled: true, parameters: { contrast: 1.1 } }],
    keyframes: [{
      id: 'position-x',
      property: 'transform.x',
      interpolation: 'linear',
      points: [
        { id: 'position-x-0', frame: 0, value: 0 },
        { id: 'position-x-30', frame: 30, value: 0.2 }
      ]
    }]
  }
  main.items.push({
    ...makeItem('nested-item', 10, 0, 1_000_000, 'video-2'),
    nestedSequenceId: alternate.id
  })
  main.captions[0] = {
    ...main.captions[0]!,
    style: {
      fontFamily: 'sans-serif',
      fontSize: 42,
      fontWeight: 700,
      color: '#FFFFFF',
      background: '#000000',
      maxWidthRatio: 0.8
    },
    words: [{ id: 'caption-word', text: 'Hello', startFrame: 0, endFrame: 15, sourceWordId: 'word-1' }],
    animation: { kind: 'word-highlight', durationFrames: 4 }
  }
  project.sequences.push(alternate)
  project.linkGroups = [{ id: 'link-main', kind: 'av', itemIds: ['item-1', 'nested-item'], locked: true }]
  project.derivedReferences = [{
    id: 'proof-1',
    kind: 'proof',
    dependencyIds: [],
    producerVersion: '1.0.0',
    status: 'ready',
    bytes: 123,
    pinned: true,
    updatedAt: project.updatedAt
  }]
  project.tracks = structuredClone(main.tracks)
  project.items = structuredClone(main.items)
  project.captions = structuredClone(main.captions)
  return project
}

function collectTargetUrls(value: unknown): string[] {
  const urls: string[] = []
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) stack.push(...current)
    else if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>
      if (typeof record.target_url === 'string') urls.push(record.target_url)
      stack.push(...Object.values(record))
    }
  }
  return urls
}

describe('OTIO JSON professional interchange', () => {
  it('exports stable IDs, exact frame/timecode metadata, and an explicit bounded loss manifest', () => {
    const project = complexProject()
    const exported = exportProjectToOtio(project)
    expect(exported.document).toMatchObject({
      OTIO_SCHEMA: 'SerializableCollection.1',
      name: 'Demo Project',
      children: [
        expect.objectContaining({ OTIO_SCHEMA: 'Timeline.1' }),
        expect.objectContaining({ OTIO_SCHEMA: 'Timeline.1' })
      ]
    })
    expect(exported.timecodeMappings).toContainEqual(expect.objectContaining({
      id: 'item-1',
      sequenceId: 'sequence-main',
      startFrame: 0,
      endFrame: 90,
      startTimecode: '00:00:00:00',
      endTimecode: '00:00:03:00'
    }))
    expect(collectTargetUrls(exported.document)).toEqual(['kun-media://asset-1', 'kun-media://asset-1', 'kun-media://asset-1'])
    const lossFeatures = new Set(exported.lossManifest.entries.map(({ feature }) => feature))
    expect([...lossFeatures]).toEqual(expect.arrayContaining([
      'caption', 'derived-media', 'effects', 'keyframes', 'link-groups', 'nested-sequence', 'transcripts', 'visual-transform'
    ]))
    expect(exported.lossManifest).toMatchObject({ portableLossless: false, kunRoundTripLossless: true, truncated: 0 })
    expect(JSON.stringify(exported.document)).not.toContain('media_asset_1')
    expect(JSON.stringify(exported.document)).not.toContain('/Users/')
  })

  it('serializes deterministically and round-trips every sequence plus nested/text/keyframe/effect metadata', () => {
    const project = complexProject()
    const first = exportProjectToOtio(project)
    const second = exportProjectToOtio(project)
    expect(first.documentDigest).toBe(second.documentDigest)
    expect(Buffer.from(serializeOtioInterchange(first))).toEqual(Buffer.from(serializeOtioInterchange(second)))

    const imported = importProjectFromOtio(serializeOtioInterchange(first))
    expect(imported.fidelity).toBe('kun-metadata')
    expect(imported.mediaRelinkRequired).toEqual(['asset-1'])
    expect(imported.project.sequences.map(({ id }) => id).sort()).toEqual(['sequence-alternate', 'sequence-main'])
    const main = imported.project.sequences.find(({ id }) => id === 'sequence-main')!
    expect(main.items.find(({ id }) => id === 'nested-item')).toMatchObject({ nestedSequenceId: 'sequence-alternate' })
    expect(main.items.find(({ id }) => id === 'item-1')).toMatchObject({
      effects: [{ id: 'color-main', type: 'color.basic' }],
      keyframes: [{ id: 'position-x', property: 'transform.x', points: [{ frame: 0 }, { frame: 30 }] }]
    })
    expect(main.captions[0]).toMatchObject({
      words: [{ id: 'caption-word', sourceWordId: 'word-1' }],
      animation: { kind: 'word-highlight', durationFrames: 4 }
    })
    expect(imported.project.assets[0]).toMatchObject({ mediaHandleId: 'otio_offline_asset-1' })
    expect(imported.project.assets[0]).not.toHaveProperty('workspaceRelativePath')
    expect(imported.project.assets[0]).toMatchObject({ availability: 'offline', recovery: { reason: 'missing' } })
  })

  it('bounds the loss report and counts omitted entries instead of silently dropping them', () => {
    const project = makeProject()
    const items = Array.from({ length: 140 }, (_, index) => ({
      ...makeItem(`bounded-loss-${index + 1}`, index * 30, 0, 1_000_000),
      transform: { x: 0.1, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
    }))
    project.sequences[0]!.items = structuredClone(items)
    project.items = structuredClone(items)

    const manifest = exportProjectToOtio(project).lossManifest
    expect(manifest.entries).toHaveLength(128)
    expect(manifest.truncated).toBeGreaterThan(0)
    expect(manifest.portableLossless).toBe(false)
    expect(manifest.kunRoundTripLossless).toBe(true)
  })

  it('rejects tampered round-trip metadata and path-bearing external references', () => {
    const exported = exportProjectToOtio(complexProject())
    const tampered = structuredClone(exported.document)
    const metadata = (tampered.metadata as Record<string, unknown>).kun as Record<string, unknown>
    const project = metadata.project as VideoProject
    project.name = 'Tampered'
    expect(() => importProjectFromOtio(tampered)).toThrowError(/digest/u)

    const pathBearing = structuredClone(exported.document)
    const stack: unknown[] = [pathBearing]
    while (stack.length > 0) {
      const current = stack.pop()
      if (Array.isArray(current)) stack.push(...current)
      else if (current && typeof current === 'object') {
        const record = current as Record<string, unknown>
        if (record.OTIO_SCHEMA === 'ExternalReference.1') {
          record.target_url = 'file:///Users/example/private.mov'
          break
        }
        stack.push(...Object.values(record))
      }
    }
    expect(() => importProjectFromOtio(pathBearing)).toThrowError(/kun-media/u)
  })

  it('imports a bounded portable OTIO timeline without requiring Kun snapshot metadata', () => {
    const rate = 30_000 / 1_001
    const rationalTime = (value: number) => ({ OTIO_SCHEMA: 'RationalTime.1', value, rate })
    const sourceRange = (start: number, duration: number) => ({
      OTIO_SCHEMA: 'TimeRange.1',
      start_time: rationalTime(start),
      duration: rationalTime(duration)
    })
    const document = {
      OTIO_SCHEMA: 'SerializableCollection.1',
      name: 'External cut',
      metadata: {},
      children: [{
        OTIO_SCHEMA: 'Timeline.1',
        name: 'Imported sequence',
        global_start_time: rationalTime(0),
        metadata: {},
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'Tracks',
          metadata: {},
          children: [{
            OTIO_SCHEMA: 'Track.1',
            name: 'Picture',
            kind: 'Video',
            metadata: {},
            effects: [],
            markers: [],
            children: [
              {
                OTIO_SCHEMA: 'Gap.1',
                name: 'Gap',
                source_range: sourceRange(0, 12),
                effects: [], markers: [], metadata: {}
              },
              {
                OTIO_SCHEMA: 'Clip.2',
                name: 'External interview',
                source_range: sourceRange(24, 48),
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  name: 'External interview',
                  target_url: 'kun-media://external-asset',
                  available_range: sourceRange(0, 120),
                  metadata: {}
                },
                effects: [{
                  OTIO_SCHEMA: 'Effect.1',
                  name: 'External color',
                  effect_name: 'color.basic',
                  metadata: {}
                }],
                markers: [],
                metadata: {}
              }
            ]
          }],
          effects: [], markers: []
        }
      }]
    }

    const imported = importProjectFromOtio(document)
    expect(imported).toMatchObject({
      fidelity: 'portable-otio',
      mediaRelinkRequired: ['external-asset'],
      lossManifest: { portableLossless: false, kunRoundTripLossless: false }
    })
    expect(imported.project.fps).toEqual({ numerator: 30_000, denominator: 1_001 })
    expect(imported.project.sequences[0]).toMatchObject({
      id: 'sequence-1',
      tracks: [{ id: 'sequence-1.track-1', kind: 'video' }],
      items: [{
        id: 'sequence-1.track-1.clip-2',
        assetId: 'external-asset',
        timelineStartFrame: 12,
        durationFrames: 48,
        effects: [{ type: 'color.basic', enabled: true, parameters: {} }]
      }]
    })
    expect(imported.project.assets[0]).toMatchObject({
      id: 'external-asset', mediaHandleId: 'otio_offline_external-asset', availability: 'offline'
    })
    expect(imported.timecodeMappings[0]).toMatchObject({ startFrame: 12, endFrame: 60 })
  })

  it('maps non-drop frame timecodes deterministically from rational rates', () => {
    expect(frameTimecode(1_800, { numerator: 30, denominator: 1 })).toBe('00:01:00:00')
    expect(frameTimecode(1_800, { numerator: 30_000, denominator: 1_001 })).toBe('00:01:00:00')
  })
})
