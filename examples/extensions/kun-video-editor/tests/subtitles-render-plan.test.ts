import { describe, expect, it } from 'vitest'
import {
  escapeDrawtextText,
  escapeSubtitleText,
  generateRenderPlan,
  generateSubtitles,
  type FfmpegRenderStep,
  type TextRenderStep
} from '../src/engine/index.js'
import { makeItem, makeProject } from './fixtures.js'

describe('subtitles and render plans', () => {
  it('applies both FFmpeg escaping levels to burned-caption text without shell quoting', () => {
    expect(escapeDrawtextText("Crime d'Amour: [x],y; \\ %\nnext")).toBe(
      "Crime d\\\\\\'Amour\\\\: \\[x\\]\\,y\\; \\\\\\\\ % next"
    )
  })

  it('escapes subtitle markup, cue arrows, control bytes, and orders cues', () => {
    const project = makeProject()
    project.captions = [
      {
        id: 'later',
        trackId: 'captions-1',
        startFrame: 30,
        endFrame: 60,
        text: 'A --> B\u0000',
        placement: 'bottom'
      },
      {
        id: 'first',
        trackId: 'captions-1',
        startFrame: 0,
        endFrame: 30,
        text: '<b>& text</b>',
        placement: 'bottom'
      }
    ]
    const srt = generateSubtitles(project.captions, project.fps, 'srt')
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000')
    expect(srt).toContain('&lt;b&gt;&amp; text&lt;/b&gt;')
    expect(srt).toContain('A → B')
    expect(srt).not.toContain('\u0000')
    const vtt = generateSubtitles(project.captions, project.fps, 'vtt')
    expect(vtt.startsWith('WEBVTT\n\nfirst\n')).toBe(true)
  })

  it('keeps non-cue --!> text escaped rather than treating it as markup', () => {
    expect(escapeSubtitleText('A --> B --!> <tag>')).toBe('A → B --!&gt; &lt;tag&gt;')
  })

  it('generates a revision-bound proof-frame plan with opaque placeholders', () => {
    const project = makeProject()
    const plan = generateRenderPlan(project, {
      kind: 'proof-frame',
      expectedRevision: 0,
      outputHandleId: 'proof-output',
      proofFrame: 30,
      captionMode: 'burned'
    })
    expect(plan).toMatchObject({
      schemaVersion: 1,
      projectId: project.id,
      revision: 0,
      renderKind: 'proof-frame'
    })
    const step = plan.steps[0] as FfmpegRenderStep
    expect(step.inputs).toEqual({
      'clip-0': { kind: 'media-handle', reference: 'media_asset_1' }
    })
    expect(step.args).toContain('{{input:clip-0}}')
    expect(step.args).toContain('{{output:proof}}')
    const graph = step.args[step.args.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('color=c=#000000:s=1920x1080:r=30/1:d=1.033333[base]')
    expect(graph).toContain('colorchannelmixer=aa=1.0000')
    expect(graph).toContain("overlay=x='(W-w)/2+0.000':y='(H-h)/2+0.000'")
    expect(graph).toContain('drawtext=text=Hello')
    expect(graph).toContain('trim=start_frame=30:end_frame=31,setpts=PTS-STARTPTS[proof-frame-output]')
    expect(step.args).not.toContain('-vf')
    expect(step.args.join(' ')).not.toContain('/tmp/')
  })

  it('orders proof and preview overlays by track order with stable item tie-breakers', () => {
    const project = makeProject()
    const bottom = makeItem('z-bottom', 0, 0, 3_000_000, 'video-1')
    bottom.transform = { ...bottom.transform, x: -24, y: 12 }
    const top = makeItem('a-top', 0, 0, 3_000_000, 'video-2')
    top.transform = { ...top.transform, x: 72, y: -18 }
    top.opacity = 0.35
    project.items = [top, bottom]
    project.tracks = [...project.tracks].reverse()

    const proof = generateRenderPlan(project, {
      kind: 'proof-frame',
      expectedRevision: 0,
      outputHandleId: 'proof-output',
      proofFrame: 10
    }).steps[0] as FfmpegRenderStep
    const preview = generateRenderPlan(project, {
      kind: 'preview',
      expectedRevision: 0,
      outputHandleId: 'preview-output'
    }).steps[0] as FfmpegRenderStep

    expect(Object.keys(proof.inputs)).toEqual(['clip-0', 'clip-1'])
    expect(Object.keys(preview.inputs)).toEqual(['clip-0', 'clip-1'])
    const proofGraph = proof.args[proof.args.indexOf('-filter_complex') + 1]!
    const previewGraph = preview.args[preview.args.indexOf('-filter_complex') + 1]!
    for (const graph of [proofGraph, previewGraph]) {
      expect(graph.indexOf('[base][vprep0]overlay')).toBeLessThan(
        graph.indexOf('[vcomp0][vprep1]overlay')
      )
      expect(graph).toContain("x='(W-w)/2+72.000':y='(H-h)/2+-18.000'")
      expect(graph).toContain('colorchannelmixer=aa=0.3500')
    }
  })

  it('plans H.264 preview/export, burned captions, audio, SRT, and VTT artifacts', () => {
    const project = makeProject()
    project.canvas = { ...project.canvas, preset: '9:16', width: 1080, height: 1920, fit: 'crop' }
    const video = generateRenderPlan(project, {
      kind: 'h264-mp4',
      expectedRevision: 0,
      outputHandleId: 'video-output',
      captionMode: 'both',
      subtitleFormat: 'vtt',
      subtitleOutputHandleId: 'subtitle-output'
    })
    expect(video.steps.filter(({ kind }) => kind === 'write-text')).toHaveLength(1)
    const ffmpeg = video.steps.find(({ kind }) => kind === 'ffmpeg') as FfmpegRenderStep
    expect(ffmpeg.args).toContain('libx264')
    expect(ffmpeg.args).toContain('yuv420p')
    expect(ffmpeg.args.join(' ')).toContain('crop=1080:1920')
    expect(ffmpeg.args.join(' ')).toContain('drawtext=text=Hello')
    expect(ffmpeg.args.join(' ')).toContain('expansion=none')
    expect(ffmpeg.inputs).not.toHaveProperty('captions')
    expect(video.artifacts.map(({ mime }) => mime)).toEqual(['text/vtt', 'video/mp4'])

    const preview = generateRenderPlan(project, {
      kind: 'preview',
      expectedRevision: 0,
      outputHandleId: 'preview-output'
    })
    expect((preview.steps[0] as FfmpegRenderStep).args).toContain('veryfast')

    const audio = generateRenderPlan(project, {
      kind: 'audio-aac',
      expectedRevision: 0,
      outputHandleId: 'audio-output'
    })
    expect((audio.steps[0] as FfmpegRenderStep).args).toContain('aac')
    expect(audio.artifacts[0]!.mime).toBe('audio/mp4')

    const subtitles = generateRenderPlan(project, {
      kind: 'subtitles',
      expectedRevision: 0,
      outputHandleId: 'srt-output',
      subtitleFormat: 'srt'
    })
    expect((subtitles.steps[0] as TextRenderStep).content).toContain('00:00:00,000')
    expect(subtitles.artifacts[0]!.mime).toBe('application/x-subrip')
  })

  it('uses bounded bindings and a compact concat graph for thirty sequential cuts', () => {
    const project = makeProject()
    project.canvas = { ...project.canvas, width: 640, height: 360 }
    project.captions = []
    project.items = Array.from({ length: 30 }, (_unused, index) => ({
      ...makeItem(`${'split-part-'.repeat(8)}${index}`, index * 3, 0, 100_000),
      id: `${'split-part-'.repeat(8)}${index}`,
      timelineStartFrame: index * 3,
      durationFrames: 3
    }))

    const step = generateRenderPlan(project, {
      kind: 'preview',
      expectedRevision: 0,
      outputHandleId: 'preview-output'
    }).steps[0] as FfmpegRenderStep
    const graph = step.args[step.args.indexOf('-filter_complex') + 1]!

    expect(Object.keys(step.inputs)).toEqual(Array.from({ length: 30 }, (_unused, index) => `clip-${index}`))
    expect(step.args).toContain('{{input:clip-29}}')
    expect(graph).toContain('concat=n=30:v=1:a=1[vout][aout]')
    expect(graph.length).toBeLessThanOrEqual(8_000)
    expect(step.args.every((argument) => argument.length <= 8_192)).toBe(true)
  })

  it('fits and crops to the base canvas before applying item scale', () => {
    const project = makeProject()
    project.captions = []
    project.canvas = { ...project.canvas, width: 640, height: 360, fit: 'crop' }
    project.items = [{
      ...project.items[0]!,
      durationFrames: 30,
      sourceEndUs: 1_000_000,
      transform: { ...project.items[0]!.transform, scaleX: 0.5, scaleY: 0.5 }
    }]

    const step = generateRenderPlan(project, {
      kind: 'preview',
      expectedRevision: 0,
      outputHandleId: 'preview-output'
    }).steps[0] as FfmpegRenderStep
    const graph = step.args[step.args.indexOf('-filter_complex') + 1]!
    const crop = graph.indexOf('crop=640:360')
    const transformedScale = graph.indexOf('scale=iw*0.500000:ih*0.500000')

    expect(crop).toBeGreaterThan(-1)
    expect(transformedScale).toBeGreaterThan(crop)
  })

  it('compiles crop, opacity, visual/audio fades, and volume from the canonical IR', () => {
    const project = makeProject()
    project.captions = []
    project.items = [{
      ...project.items[0]!,
      crop: { left: 0.1, top: 0.05, right: 0.1, bottom: 0.15 },
      opacity: 0.6,
      volume: 0.75,
      fadeInFrames: 6,
      fadeOutFrames: 9
    }]

    const plan = generateRenderPlan(project, {
      kind: 'preview',
      expectedRevision: 0,
      outputHandleId: 'preview-output'
    })
    expect(plan.renderIr.layers[0]).toMatchObject({
      visual: {
        crop: { left: 0.1, top: 0.05, right: 0.1, bottom: 0.15 },
        opacity: 0.6,
        fadeInFrames: 6,
        fadeOutFrames: 9
      },
      audio: { volume: 0.75, fadeInFrames: 6, fadeOutFrames: 9 }
    })
    const step = plan.steps[0] as FfmpegRenderStep
    const graph = step.args[step.args.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('crop=iw*0.800000:ih*0.800000:iw*0.100000:ih*0.050000')
    expect(graph).toContain('fade=t=in:start_frame=0:nb_frames=6:alpha=1')
    expect(graph).toContain('fade=t=out:start_frame=81:nb_frames=9:alpha=1')
    expect(graph).toContain('colorchannelmixer=aa=0.6000')
    expect(graph).toContain('afade=t=in:st=0:d=6/30')
    expect(graph).toContain('afade=t=out:st=81/30:d=9/30')
    expect(graph).toContain('volume=0.7500')
  })

  it('rejects stale plans and proof frames outside the composition', () => {
    const project = makeProject()
    expect(() => generateRenderPlan(project, {
      kind: 'h264-mp4',
      expectedRevision: 2,
      outputHandleId: 'output'
    })).toThrowError(/stale project revision/u)
    expect(() => generateRenderPlan(project, {
      kind: 'proof-frame',
      expectedRevision: 0,
      outputHandleId: 'output',
      proofFrame: 999
    })).toThrowError(/inside the composed timeline/u)
    project.captions = []
    expect(() => generateRenderPlan(project, {
      kind: 'h264-mp4',
      expectedRevision: 0,
      outputHandleId: 'video-output',
      captionMode: 'sidecar',
      subtitleOutputHandleId: 'subtitle-output'
    })).toThrowError(/project has no captions/u)
  })
})
