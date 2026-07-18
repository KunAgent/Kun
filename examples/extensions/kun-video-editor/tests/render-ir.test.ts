import { describe, expect, it } from 'vitest'
import {
  VideoEngineError,
  compileRenderIr,
  defaultFfmpegCapabilities,
  generateRenderPlan,
  negotiateRenderIr,
  renderCapabilitiesDigest,
  renderIrDigest,
  resolveInteractivePlayback,
  validateRenderIr,
  type CanonicalRenderIr,
  type RenderBackendCapabilities
} from '../src/engine/index.js'
import { makeProject } from './fixtures.js'

describe('canonical Render IR', () => {
  it('captures bounded render semantics deterministically, including nonzero transforms', () => {
    const project = makeProject()
    project.id = 'render-node-10'
    project.items = [{
      ...project.items[0]!,
      transform: { x: 24, y: -12, scaleX: 0.75, scaleY: 0.5, rotation: 15 },
      crop: { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 },
      opacity: 0.8,
      volume: 1.25,
      fadeInFrames: 6,
      fadeOutFrames: 9,
      effects: [{
        id: 'effect-blur-10',
        type: 'blur',
        enabled: true,
        parameters: { radius: 4, quality: 'balanced', edge: true }
      }],
      keyframes: [{
        id: 'keyframes-position-10',
        property: 'transform.x',
        interpolation: 'linear',
        points: [
          { id: 'point-0', frame: 0, value: 24 },
          { id: 'point-30', frame: 30, value: 96 }
        ]
      }]
    }]
    project.captions = [{
      id: 'caption-render-10',
      trackId: 'captions-1',
      startFrame: 0,
      endFrame: 45,
      text: 'Rendered caption',
      placement: 'bottom',
      style: {
        fontFamily: 'Kun Sans',
        fontSize: 42,
        color: '#F0F0F0',
        background: '#101010',
        fontWeight: 600,
        maxWidthRatio: 0.8
      },
      words: [{
        id: 'word-render-10',
        text: 'Rendered',
        startFrame: 0,
        endFrame: 20,
        sourceWordId: 'source-word-10'
      }],
      animation: { kind: 'fade', durationFrames: 6 }
    }]

    const ir = compileRenderIr(project, {
      range: { startFrame: 0, endFrame: 90 },
      textPolicy: 'burned'
    })

    expect(ir).toMatchObject({
      schemaVersion: 1,
      projectId: 'render-node-10',
      sequenceId: 'sequence-main',
      revision: 0,
      range: { startFrame: 0, endFrame: 90 },
      canvas: {
        colorSpace: 'bt709',
        colorRange: 'tv',
        pixelAspectRatio: { numerator: 1, denominator: 1 }
      },
      audioMix: { normalize: false, sampleRate: 48_000, channels: 2 }
    })
    expect(ir.sources).toHaveLength(1)
    expect(ir.layers[0]).toMatchObject({
      id: 'item-1',
      sourceMap: { startUs: 0, endUs: 3_000_000, speed: { numerator: 1, denominator: 1 } },
      visual: {
        transform: { x: 24, y: -12, scaleX: 0.75, scaleY: 0.5, rotation: 15 },
        crop: { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 },
        opacity: 0.8,
        fadeInFrames: 6,
        fadeOutFrames: 9
      },
      audio: { enabled: true, volume: 1.25, fadeInFrames: 6, fadeOutFrames: 9 },
      effects: [{ id: 'effect-blur-10', type: 'blur', enabled: true }],
      keyframes: [{ id: 'keyframes-position-10', property: 'transform.x' }]
    })
    expect(ir.textLayers[0]).toMatchObject({
      id: 'caption-render-10',
      style: { fontFamily: 'Kun Sans', fontWeight: 600, maxWidthRatio: 0.8 },
      words: [{ id: 'word-render-10', sourceWordId: 'source-word-10' }],
      animation: { kind: 'fade', durationFrames: 6 }
    })
    expect(renderIrDigest(structuredClone(ir))).toBe(renderIrDigest(ir))
  })

  it('enforces canonical ordering, control-character, finite-number, and node-count bounds', () => {
    const project = makeProject()
    const canonical = compileRenderIr(project)
    const reversed = structuredClone(canonical)
    reversed.layers.reverse()
    expect(() => validateRenderIr(reversed)).toThrowError(/canonical order/u)

    const newlineReference = structuredClone(canonical)
    newlineReference.sources[0]!.reference.reference = 'media\nhandle'
    expect(() => validateRenderIr(newlineReference)).toThrowError(/control characters/u)

    const nonFinite = makeProject()
    nonFinite.items[0]!.transform.x = Number.NaN
    expect(() => compileRenderIr(nonFinite)).toThrowError(/must be finite/u)

    const tooManyEffects = makeProject()
    tooManyEffects.items = [{
      ...tooManyEffects.items[0]!,
      effects: Array.from({ length: 17 }, (_unused, index) => ({
        id: `effect-${index}`,
        type: 'blur',
        enabled: true,
        parameters: {}
      }))
    }]
    expect(() => compileRenderIr(tooManyEffects)).toThrowError(/effect limit/u)
  })

  it('carries track and item visibility/audio state into canonical render semantics', () => {
    const project = makeProject()
    project.items = [{ ...project.items[0]!, visible: false, muted: true, volume: 1.5 }]
    let ir = compileRenderIr(project)
    expect(ir.layers[0]).toMatchObject({
      visual: { opacity: 0 },
      audio: { enabled: false, volume: 1.5 }
    })

    project.items[0]!.visible = true
    project.items[0]!.muted = false
    project.tracks.find(({ id }) => id === project.items[0]!.trackId)!.muted = true
    ir = compileRenderIr(project)
    expect(ir.layers[0]).toMatchObject({
      visual: { opacity: 1 },
      audio: { enabled: false }
    })
  })

  it('reports every unsupported node with its identity and actionable guidance', () => {
    const project = makeProject()
    project.items = [{
      ...project.items[0]!,
      effects: [{ id: 'effect-blur', type: 'blur', enabled: true, parameters: { radius: 4 } }],
      keyframes: [{
        id: 'keyframe-opacity',
        property: 'opacity',
        interpolation: 'linear',
        points: [{ id: 'point-start', frame: 0, value: 1 }]
      }]
    }]
    project.captions = [{
      id: 'caption-custom-font',
      trackId: 'captions-1',
      startFrame: 0,
      endFrame: 30,
      text: 'Animated',
      placement: 'bottom',
      style: { fontFamily: 'Unavailable Font' },
      animation: { kind: 'word-highlight', durationFrames: 4 }
    }]
    const ir = compileRenderIr(project, { textPolicy: 'burned' })
    const report = negotiateRenderIr(ir, defaultFfmpegCapabilities(), 'h264-mp4')

    expect(report.supported).toBe(false)
    expect(report.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'effect-blur', capability: 'effect:blur' }),
      expect.objectContaining({ nodeId: 'keyframe-opacity', capability: 'filter:keyframes' }),
      expect.objectContaining({ nodeId: 'caption-custom-font', capability: 'font:Unavailable Font' }),
      expect.objectContaining({
        nodeId: 'caption-custom-font',
        capability: 'filter:text-animation:word-highlight'
      })
    ]))
    expect(report.unsupported.every(({ guidance }) => guidance.length > 20)).toBe(true)

    let failure: unknown
    try {
      generateRenderPlan(project, {
        kind: 'h264-mp4',
        expectedRevision: 0,
        outputHandleId: 'render-output',
        captionMode: 'burned',
        backendCapabilities: {
          ...defaultFfmpegCapabilities(),
          effects: ['blur'],
          filters: [...defaultFfmpegCapabilities().filters, 'keyframes', 'text-animation:word-highlight'],
          fonts: ['*']
        }
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(VideoEngineError)
    expect((failure as VideoEngineError).details.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'effect-blur', capability: 'effect:blur' })
    ]))
  })

  it('normalizes capability catalogs and refuses hardware-only plans without an explicit backend', () => {
    const left = defaultFfmpegCapabilities()
    const right: RenderBackendCapabilities = {
      ...left,
      codecs: [...left.codecs].reverse(),
      filters: [...left.filters].reverse(),
      fonts: [...left.fonts].reverse()
    }
    expect(renderCapabilitiesDigest(left)).toBe(renderCapabilitiesDigest(right))

    const requiredHardware = { ...left, hardwareAcceleration: 'required' as const }
    const report = negotiateRenderIr(compileRenderIr(makeProject()), requiredHardware, 'preview')
    expect(report).toMatchObject({
      supported: false,
      hardwareAcceleration: 'required',
      unsupported: [expect.objectContaining({ capability: 'hardware-acceleration:required' })]
    })
  })

  it('uses the source fast path only when direct playback is compiler-proven equivalent', () => {
    const project = makeProject()
    project.captions = []
    project.assets[0]!.video!.frameRate = { numerator: 30, denominator: 1 }
    project.items = [{
      ...project.items[0]!,
      durationFrames: 300,
      sourceStartUs: 0,
      sourceEndUs: 10_000_000
    }]
    const direct = resolveInteractivePlayback(compileRenderIr(project))
    expect(direct).toMatchObject({
      mode: 'source-fast-path',
      sourceId: 'asset-1',
      layerId: 'item-1',
      reasons: []
    })

    project.items[0]!.crop = { left: 0.1, top: 0, right: 0, bottom: 0 }
    expect(resolveInteractivePlayback(compileRenderIr(project))).toMatchObject({
      mode: 'composed-proof',
      reasons: expect.arrayContaining(['crop'])
    })

    delete project.items[0]!.crop
    project.items[0]!.durationFrames = 150
    project.items[0]!.sourceEndUs = 5_000_000
    expect(resolveInteractivePlayback(compileRenderIr(project))).toMatchObject({
      mode: 'composed-proof',
      reasons: expect.arrayContaining(['trimmed-source'])
    })
  })

  it('binds preview and final export to identical IR and backend semantics', () => {
    const project = makeProject()
    const preview = generateRenderPlan(project, {
      kind: 'preview',
      expectedRevision: 0,
      outputHandleId: 'preview-output'
    })
    const final = generateRenderPlan(project, {
      kind: 'h264-mp4',
      expectedRevision: 0,
      outputHandleId: 'final-output'
    })

    expect(preview.renderIrDigest).toBe(final.renderIrDigest)
    expect(preview.backendCapabilitiesDigest).toBe(final.backendCapabilitiesDigest)
    expect(preview.renderIr).toEqual(final.renderIr)
    expect(preview.verification).toEqual({
      technicalValidation: 'pending',
      visualInspection: 'not-performed'
    })
    expect(final.verification).toEqual(preview.verification)
  })
})

// Compile-time assertion: canonical data is the durable renderer-neutral
// boundary, not an FFmpeg command graph.
const _canonicalRenderIrTypeCheck: CanonicalRenderIr | undefined = undefined
void _canonicalRenderIrTypeCheck
