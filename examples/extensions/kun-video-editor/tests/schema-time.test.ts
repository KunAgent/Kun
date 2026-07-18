import { describe, expect, it } from 'vitest'
import {
  VideoEngineError,
  VideoProjectSchema,
  MediaAssetSchema,
  RenderPresetSchema,
  TimelineItemSchema,
  assertValidTimeline,
  framesToMicroseconds,
  microsecondsToFrames,
  migrateProject,
  normalizeRational,
  rationalEquals,
  rescaleFrames,
  validateTimeline
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

describe('project schema and frame math', () => {
  it('parses a frame-native project and clones the input', () => {
    const source = makeProject()
    const parsed = VideoProjectSchema.parse(source)
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(() => assertValidTimeline(parsed)).not.toThrow()
    expect(MediaAssetSchema.parse(source.assets[0])).toEqual(source.assets[0])
    expect(TimelineItemSchema.parse(source.items[0])).toEqual(source.items[0])
    expect(RenderPresetSchema.parse({
      id: 'h264-mp4',
      width: 1920,
      height: 1080,
      videoBitrate: '8M',
      audioBitrate: '192k'
    })).toMatchObject({ id: 'h264-mp4', width: 1920 })
  })

  it('rejects unknown project migrations without mutating input', () => {
    const source = { ...makeProject(), schemaVersion: 99 }
    expect(() => migrateProject(source)).toThrowError(VideoEngineError)
    expect(source.schemaVersion).toBe(99)
  })

  it('keeps 30000/1001 calculations rational and deterministic', () => {
    const fps = { numerator: 30_000, denominator: 1001 }
    expect(normalizeRational({ numerator: 60_000, denominator: 2002 })).toEqual(fps)
    expect(rationalEquals(fps, { numerator: 60_000, denominator: 2002 })).toBe(true)
    expect(framesToMicroseconds(30_000, fps)).toBe(1_001_000_000)
    expect(microsecondsToFrames(1_001_000_000, fps)).toBe(30_000)
    expect(rescaleFrames(30_000, fps, { numerator: 24, denominator: 1 })).toBe(24_024)
  })

  it('reports dangling asset and track references', () => {
    const project = makeProject()
    project.items[0]!.assetId = 'missing'
    project.items[1]!.trackId = 'missing'
    const issues = validateTimeline(project)
    expect(issues.map(({ code }) => code)).toContain('invalid_reference')
    expect(() => assertValidTimeline(project)).toThrowError(/Missing asset/u)
  })

  it('rejects same-track overlap while allowing audio mix tracks', () => {
    const project = makeProject()
    project.items[1]!.timelineStartFrame = 30
    expect(validateTimeline(project).some(({ code }) => code === 'overlap')).toBe(true)

    project.items.forEach((item) => { item.trackId = 'audio-1' })
    expect(validateTimeline(project).some(({ code }) => code === 'overlap')).toBe(false)
  })
})
