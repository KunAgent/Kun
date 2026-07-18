import { describe, expect, it } from 'vitest'
import {
  applyTimelineScript,
  detectFillerRanges,
  detectLocalTranscriber,
  detectSilenceRanges,
  generateTimelineMarkdown,
  importTranscript,
  requireLocalTranscriber,
  validateTimelineMarkdown,
  validateTimedTranscript
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

describe('timeline.md and transcripts', () => {
  it('generates a stable revision-bound projection and applies timed cuts', () => {
    const project = makeProject()
    const script = generateTimelineMarkdown(project)
    expect(script).toContain('kun-video-timeline')
    expect(script).toContain('`segment-1`')
    expect(validateTimelineMarkdown(project, script)).toMatchObject({
      projectId: project.id,
      revision: 0
    })
    const applied = applyTimelineScript(project, script, [{
      assetId: 'asset-1',
      startUs: 1_000_000,
      endUs: 2_000_000,
      reason: 'selection'
    }])
    expect(applied.project.items).toHaveLength(3)
    expect(project.items).toHaveLength(2)
  })

  it('rejects stale revision metadata and externally changed content', () => {
    const project = makeProject()
    const script = generateTimelineMarkdown(project)
    const stale = script.replace('"revision":0', '"revision":1')
    expect(() => validateTimelineMarkdown(project, stale)).toThrowError(/different project revision/u)
    expect(() => validateTimelineMarkdown(project, `${script}\nexternal edit`))
      .toThrowError(/digest/u)
  })

  it('keeps literal backslashes and table delimiters deterministic in projections', () => {
    const project = makeProject()
    const text = String.raw`path\segment \| delimiter`
    project.captions[0] = { ...project.captions[0]!, text }
    project.sequences[0]!.captions = structuredClone(project.captions)

    const script = generateTimelineMarkdown(project)
    expect(script).toContain(`path${'\\'.repeat(2)}segment ${'\\'.repeat(3)}| delimiter`)
    expect(validateTimelineMarkdown(project, script)).toMatchObject({ projectId: project.id })
    expect(generateTimelineMarkdown(project)).toBe(script)
  })

  it('imports SRT, VTT, and timed JSON and rejects invalid timing', () => {
    const asset = makeProject().assets[0]!
    const srt = importTranscript(
      '1\n00:00:00,000 --> 00:00:01,000\nHello\n\n2\n00:00:01,500 --> 00:00:02,000\nWorld\n',
      { format: 'srt', transcriptId: 'srt-1', asset, language: 'en' }
    )
    expect(srt.segments).toHaveLength(2)
    expect(srt.segments[1]).toMatchObject({ startUs: 1_500_000, endUs: 2_000_000 })

    const vtt = importTranscript(
      'WEBVTT\n\nintro\n00:00.000 --> 00:01.000\nHello\n',
      { format: 'vtt', transcriptId: 'vtt-1', asset }
    )
    expect(vtt.segments[0]).toMatchObject({ id: 'intro', startUs: 0, endUs: 1_000_000 })

    const json = importTranscript(JSON.stringify({
      language: 'zh',
      segments: [{
        id: 'json-1',
        start: 0,
        end: 1,
        text: '嗯',
        words: [{ id: 'json-word-1', startUs: 0, endUs: 200_000, text: '嗯' }]
      }]
    }), { format: 'json', transcriptId: 'json-transcript', asset })
    expect(json.language).toBe('zh')
    expect(json.segments[0]!.words?.[0]!.endUs).toBe(200_000)

    const invalid = structuredClone(json)
    invalid.segments[0]!.endUs = asset.durationUs + 1
    expect(() => validateTimedTranscript(invalid, asset)).toThrowError(/ordered in-bounds timing/u)
  })

  it('detects filler and silence ranges only from explicit timings', () => {
    const transcript = makeProject().transcripts[0]!
    expect(detectFillerRanges(transcript)).toEqual([{
      assetId: 'asset-1',
      startUs: 1_100_000,
      endUs: 1_300_000,
      reason: 'filler'
    }])
    expect(detectSilenceRanges(transcript, 5_000_000, 500_000)).toEqual([{
      assetId: 'asset-1',
      startUs: 4_000_000,
      endUs: 5_000_000,
      reason: 'silence'
    }])
  })

  it('reports local transcriber availability explicitly', async () => {
    const available = await detectLocalTranscriber({
      configuredPath: '/opt/local/bin/whisper-cli',
      env: { PATH: '' },
      canExecute: async (path) => path.endsWith('whisper-cli')
    })
    expect(requireLocalTranscriber(available)).toMatchObject({
      available: true,
      backend: 'whisper-cli',
      source: 'configured'
    })
    const unavailable = await detectLocalTranscriber({
      env: { PATH: '' },
      canExecute: async () => false
    })
    expect(unavailable).toMatchObject({ available: false, code: 'transcriber_unavailable' })
    expect(() => requireLocalTranscriber(unavailable)).toThrowError(/Install whisper-cli/u)
  })
})
