import { describe, expect, it } from 'vitest'
import { buildEditableCaptions, type Transcript } from '../src/engine/index.js'
import { makeItem, makeProject } from './fixtures.js'

describe('editable caption planning', () => {
  it('segments by punctuation, word count, and rendered width with rich editable timing', () => {
    const project = makeProject()
    project.captions = []
    project.items = [{
      ...makeItem('trimmed-fast-item', 10, 500_000, 2_500_000),
      durationFrames: 30,
      speed: { numerator: 2, denominator: 1 }
    }]
    const transcript: Transcript = {
      id: 'caption-transcript',
      assetId: 'asset-1',
      language: 'en',
      provenance: 'json',
      segments: [{
        id: 'caption-segment', startUs: 0, endUs: 3_000_000,
        text: 'outside Hello world. This stays visible outside',
        words: [
          { id: 'outside-left', startUs: 100_000, endUs: 300_000, text: 'outside' },
          { id: 'hello', startUs: 600_000, endUs: 900_000, text: 'Hello' },
          { id: 'world', startUs: 900_000, endUs: 1_200_000, text: 'world.' },
          { id: 'this', startUs: 1_300_000, endUs: 1_550_000, text: 'This' },
          { id: 'stays', startUs: 1_550_000, endUs: 1_800_000, text: 'stays' },
          { id: 'visible', startUs: 1_800_000, endUs: 2_200_000, text: 'visible' },
          { id: 'outside-right', startUs: 2_600_000, endUs: 2_900_000, text: 'outside' }
        ]
      }]
    }
    const plan = buildEditableCaptions(project, [transcript], {
      trackId: 'captions-1',
      idPrefix: 'generated-caption',
      maxWords: 2,
      maxRenderedWidthPx: 400,
      placement: 'bottom',
      style: { fontSize: 40, maxWidthRatio: 0.8 },
      animation: { kind: 'word-highlight', durationFrames: 4 }
    })
    expect(plan.captions.length).toBeGreaterThanOrEqual(3)
    expect(plan.captions[0]).toMatchObject({
      startFrame: 12,
      text: 'Hello world.',
      style: { fontSize: 40, color: '#FFFFFF', background: '#000000', maxWidthRatio: 0.8 },
      animation: { kind: 'word-highlight', durationFrames: 4 },
      source: { transcriptId: 'caption-transcript', itemId: 'trimmed-fast-item' }
    })
    expect(plan.captions.flatMap(({ words }) => words).map(({ sourceWordId }) => sourceWordId))
      .not.toContain('outside-left')
    expect(plan.captions.flatMap(({ words }) => words).map(({ sourceWordId }) => sourceWordId))
      .not.toContain('outside-right')
    expect(plan.captions.every(({ startFrame, endFrame }) => startFrame >= 10 && endFrame <= 40 && endFrame > startFrame)).toBe(true)
    expect(plan.operations).toHaveLength(plan.captions.length)
    expect(plan.operations[0]).toMatchObject({
      type: 'add-caption',
      caption: {
        trackId: 'captions-1',
        placement: 'bottom',
        style: { fontSize: 40, maxWidthRatio: 0.8 },
        sourceTranscriptId: 'caption-transcript',
        sourceSegmentIds: ['caption-segment'],
        words: expect.arrayContaining([expect.objectContaining({ sourceWordId: 'hello' })]),
        animation: { kind: 'word-highlight', durationFrames: 4 }
      }
    })
    expect(plan.interpolatedWordCount).toBe(0)
  })

  it('interpolates segment-only timing honestly and handles CJK width without losing editability', () => {
    const project = makeProject()
    project.captions = []
    project.items = [makeItem('cjk-item', 0, 0, 2_000_000)]
    const transcript: Transcript = {
      id: 'cjk-transcript',
      assetId: 'asset-1',
      language: 'zh-CN',
      provenance: 'srt',
      segments: [{ id: 'cjk-segment', startUs: 0, endUs: 2_000_000, text: '你好世界。这是昆。' }]
    }
    const plan = buildEditableCaptions(project, [transcript], {
      trackId: 'captions-1',
      maxWords: 4,
      maxRenderedWidthPx: 140,
      style: { fontSize: 36 }
    })
    expect(plan.captions.length).toBeGreaterThan(1)
    expect(plan.interpolatedWordCount).toBeGreaterThan(0)
    expect(plan.captions.flatMap(({ words }) => words).every(({ timing }) => timing === 'interpolated')).toBe(true)
    expect(plan.captions.map(({ text }) => text).join('')).toContain('你好世界')
  })

  it('refuses invalid tracks and bounds overlapping caption clips', () => {
    const project = makeProject()
    expect(() => buildEditableCaptions(project, project.transcripts, { trackId: 'video-1' }))
      .toThrowError(/caption track/u)

    project.captions = []
    project.items.push({ ...project.items[0]!, id: 'overlap-copy', trackId: 'video-2' })
    const plan = buildEditableCaptions(project, project.transcripts, {
      trackId: 'captions-1', maxWords: 3, maxRenderedWidthPx: 1000
    })
    expect(plan.warnings.some((warning) => /overlap/u.test(warning))).toBe(true)
    for (let index = 1; index < plan.captions.length; index += 1) {
      expect(plan.captions[index]!.startFrame).toBeGreaterThanOrEqual(plan.captions[index - 1]!.endFrame)
    }
  })
})
