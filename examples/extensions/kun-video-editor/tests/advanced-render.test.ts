import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import {
  advancedRenderCapabilitiesDigest,
  baselineAdvancedFfmpegCapabilities,
  negotiateAdvancedEffects,
  negotiateAdvancedExport,
  type AdvancedExportSettings,
  type AdvancedRenderCapabilities
} from '../src/engine/advanced-render.js'
import { compileRenderIr } from '../src/engine/render-ir.js'
import { makeProject } from './fixtures.js'

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

function effectIr(effectType: string, parameters: Record<string, number> = {}) {
  const project = makeProject()
  project.sequences[0]!.items[0]!.effects = [{
    id: `effect-${effectType.replace('.', '-')}`,
    type: effectType,
    enabled: true,
    parameters
  }]
  project.items = structuredClone(project.sequences[0]!.items)
  return compileRenderIr(project)
}

function gpuCapabilities(): AdvancedRenderCapabilities {
  const capabilities = baselineAdvancedFfmpegCapabilities()
  capabilities.gpuDevices = [{
    id: 'opencl-0',
    api: 'opencl',
    filters: ['avgblur_opencl', 'unsharp_opencl'],
    encoders: [],
    maxPixelsPerFrame: 8_294_400,
    maxFps: 60
  }]
  return capabilities
}

function settings(format: AdvancedExportSettings['format']): AdvancedExportSettings {
  return {
    format,
    width: 1_280,
    height: 720,
    frameRate: { numerator: 24, denominator: 1 },
    quality: 'high',
    acceleration: 'cpu',
    audio: { codec: format === 'prores-mov' ? 'pcm-s24' : 'aac', sampleRate: 48_000, channels: 2 }
  }
}

describe('advanced color/effect and export negotiation', () => {
  it('uses one deterministic CPU fallback when a preferred GPU cannot execute the complete chain', () => {
    const project = makeProject()
    project.sequences[0]!.items[0]!.effects = [
      { id: 'color-1', type: 'color.basic', enabled: true, parameters: { contrast: 1.2, saturation: 0.8 } },
      { id: 'blur-1', type: 'blur', enabled: true, parameters: { radius: 3 } }
    ]
    project.items = structuredClone(project.sequences[0]!.items)
    const ir = compileRenderIr(project)
    const preview = negotiateAdvancedEffects(ir, gpuCapabilities(), {
      target: 'preview', acceleration: 'prefer-gpu'
    })
    const exported = negotiateAdvancedEffects(ir, gpuCapabilities(), {
      target: 'export', acceleration: 'prefer-gpu'
    })

    expect(preview).toMatchObject({
      supported: true,
      acceleration: { requested: 'prefer-gpu', selected: 'cpu', fellBackToCpu: true }
    })
    expect(preview.layers[0]!.filterChain).toContain('eq=brightness=0.000000:contrast=1.200000')
    expect(preview.layers[0]!.filterChain).toContain('boxblur=luma_radius=3')
    expect(preview.warnings).toEqual([
      expect.objectContaining({ capability: 'fallback:cpu' })
    ])
    expect(preview.renderSemanticsDigest).toBe(exported.renderSemanticsDigest)
  })

  it('selects an allowlisted GPU chain only when one device can execute every effect', () => {
    const plan = negotiateAdvancedEffects(effectIr('blur', { radius: 4 }), gpuCapabilities(), {
      target: 'preview', acceleration: 'prefer-gpu'
    })
    expect(plan).toMatchObject({
      supported: true,
      acceleration: { selected: 'gpu', deviceId: 'opencl-0', fellBackToCpu: false }
    })
    expect(plan.layers[0]!.filterChain).toBe(
      'format=rgba,hwupload,avgblur_opencl=sizeX=4:sizeY=4,hwdownload,format=yuv420p'
    )
  })

  it('reports unsupported GPU requirements, effect parameters, and performance limits actionably', () => {
    const gpuRequired = negotiateAdvancedEffects(effectIr('color.basic'), gpuCapabilities(), {
      target: 'export', acceleration: 'require-gpu'
    })
    expect(gpuRequired.supported).toBe(false)
    expect(gpuRequired.issues).toEqual([
      expect.objectContaining({ nodeId: 'backend', capability: 'acceleration:gpu', guidance: expect.any(String) })
    ])

    const invalidParameters = negotiateAdvancedEffects(effectIr('blur', { radius: 101 }), baselineAdvancedFfmpegCapabilities(), {
      target: 'export', acceleration: 'cpu'
    })
    expect(invalidParameters.supported).toBe(false)
    expect(invalidParameters.issues).toEqual([
      expect.objectContaining({ capability: 'effect-parameters:blur' })
    ])

    const limited = baselineAdvancedFfmpegCapabilities()
    limited.limits.maxPixelsPerFrame = 100
    const overLimit = negotiateAdvancedEffects(effectIr('blur'), limited, {
      target: 'preview', acceleration: 'cpu'
    })
    expect(overLimit.supported).toBe(false)
    expect(overLimit.issues).toContainEqual(expect.objectContaining({ capability: 'limit:pixels' }))
  })

  it('normalizes capability evidence and negotiates quality, resolution, frame rate, and audio settings', () => {
    const ir = compileRenderIr(makeProject())
    const capabilities = baselineAdvancedFfmpegCapabilities()
    const reversed = {
      ...capabilities,
      encoders: [...capabilities.encoders].reverse(),
      muxers: [...capabilities.muxers].reverse(),
      filters: [...capabilities.filters].reverse(),
      effects: [...capabilities.effects].reverse()
    }
    expect(advancedRenderCapabilitiesDigest(capabilities)).toBe(advancedRenderCapabilitiesDigest(reversed))

    const plan = negotiateAdvancedExport(ir, settings('h265-mp4'), capabilities)
    expect(plan).toMatchObject({
      supported: true,
      selected: {
        format: 'h265-mp4',
        encoder: 'libx265',
        muxer: 'mp4',
        extension: 'mp4',
        hardwareAccelerated: false,
        videoFilterSuffix: ['scale=1280:720:flags=lanczos', 'fps=24/1']
      },
      capabilityEvidence: {
        requestedFormat: 'h265-mp4',
        selectedFormat: 'h265-mp4',
        selectedEncoder: 'libx265',
        portableEquivalent: false
      }
    })
    expect(plan.selected!.videoArgs).toEqual(expect.arrayContaining(['-crf', '19', '-tag:v', 'hvc1']))
    expect(plan.selected!.audioArgs).toEqual(expect.arrayContaining(['-c:a', 'aac', '-b:a', '192k']))
  })

  it('uses an explicit FFV1 portable equivalent for unavailable ProRes and never silently downgrades', () => {
    const ir = compileRenderIr(makeProject())
    const capabilities = baselineAdvancedFfmpegCapabilities()
    capabilities.encoders = capabilities.encoders.filter((encoder) => encoder !== 'prores_ks')
    const refused = negotiateAdvancedExport(ir, settings('prores-mov'), capabilities)
    expect(refused.supported).toBe(false)
    expect(refused.issues).toContainEqual(expect.objectContaining({ capability: 'codec:prores-mov' }))

    const requested = { ...settings('prores-mov'), allowPortableEquivalent: true }
    const fallback = negotiateAdvancedExport(ir, requested, capabilities)
    expect(fallback).toMatchObject({
      supported: true,
      selected: { format: 'ffv1-mkv', encoder: 'ffv1', muxer: 'matroska', extension: 'mkv' },
      capabilityEvidence: { portableEquivalent: true, selectedFormat: 'ffv1-mkv' }
    })
    expect(fallback.warnings).toContainEqual(expect.objectContaining({ capability: 'fallback:ffv1-mkv' }))
  })

  it('refuses required GPU encoding and unsafe container/audio combinations with per-target evidence', () => {
    const ir = compileRenderIr(makeProject())
    const capabilities = baselineAdvancedFfmpegCapabilities()
    const required = negotiateAdvancedExport(ir, {
      ...settings('h265-mp4'), acceleration: 'require-gpu'
    }, capabilities)
    expect(required.supported).toBe(false)
    expect(required.capabilityEvidence.encoderCandidates).toContain('hevc_videotoolbox')
    expect(required.issues).toContainEqual(expect.objectContaining({ capability: 'codec:h265-mp4' }))

    const pcmInMp4 = negotiateAdvancedExport(ir, {
      ...settings('h265-mp4'),
      audio: { codec: 'pcm-s24', sampleRate: 48_000, channels: 2 }
    }, capabilities)
    expect(pcmInMp4.supported).toBe(false)
    expect(pcmInMp4.issues).toContainEqual(expect.objectContaining({ capability: 'container-audio:mp4/pcm-s24' }))
  })

  it('executes and probes negotiated H.265 and ProRes outputs when local encoders are available', async () => {
    const encoderList = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    const encoderCatalog = `${encoderList.stdout}${encoderList.stderr}`
    if (encoderList.status !== 0 || !encoderCatalog.includes('libx265') || !encoderCatalog.includes('prores_ks')) return
    const root = await mkdtemp(join(tmpdir(), 'kun-advanced-codec-'))
    roots.push(root)
    const ir = compileRenderIr(makeProject())
    const capabilities = baselineAdvancedFfmpegCapabilities()
    for (const format of ['h265-mp4', 'prores-mov'] as const) {
      const requested = { ...settings(format), width: 64, height: 64, frameRate: { numerator: 12, denominator: 1 } }
      const plan = negotiateAdvancedExport(ir, requested, capabilities)
      expect(plan.supported).toBe(true)
      const output = join(root, `sample.${plan.selected!.extension}`)
      const args = [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=12:duration=0.25',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
        '-shortest', '-vf', plan.selected!.videoFilterSuffix.join(','),
        ...plan.selected!.videoArgs,
        ...plan.selected!.audioArgs,
        ...plan.selected!.muxerArgs,
        output
      ]
      const encoded = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 30_000 })
      expect(encoded.status, encoded.stderr).toBe(0)
      const probed = spawnSync('ffprobe', [
        '-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
        '-of', 'json', output
      ], { encoding: 'utf8', timeout: 10_000 })
      expect(probed.status, probed.stderr).toBe(0)
      const probe = JSON.parse(probed.stdout) as { streams: Array<{ codec_name: string; width?: number; height?: number }> }
      expect(probe.streams[0]).toMatchObject({
        codec_name: format === 'h265-mp4' ? 'hevc' : 'prores', width: 64, height: 64
      })
      expect((await readFile(output)).byteLength).toBeGreaterThan(0)
    }
  }, 60_000)

  it('executes the negotiated deterministic CPU color/effect fallback when local FFmpeg filters are available', async () => {
    const filters = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' })
    const catalog = `${filters.stdout}${filters.stderr}`
    if (filters.status !== 0 || !catalog.includes(' eq ') || !catalog.includes(' boxblur ')) return
    const project = makeProject()
    project.sequences[0]!.items[0]!.effects = [
      { id: 'color-exec', type: 'color.basic', enabled: true, parameters: { brightness: 0.05, contrast: 1.1 } },
      { id: 'blur-exec', type: 'blur', enabled: true, parameters: { radius: 2 } }
    ]
    project.items = structuredClone(project.sequences[0]!.items)
    const plan = negotiateAdvancedEffects(compileRenderIr(project), baselineAdvancedFfmpegCapabilities(), {
      target: 'preview', acceleration: 'prefer-gpu'
    })
    expect(plan.supported).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'kun-advanced-effects-'))
    roots.push(root)
    const output = join(root, 'effect-proof.png')
    const rendered = spawnSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=1:duration=1',
      '-vf', plan.layers[0]!.filterChain,
      '-frames:v', '1', output
    ], { encoding: 'utf8', timeout: 10_000 })
    expect(rendered.status, rendered.stderr).toBe(0)
    expect((await readFile(output)).byteLength).toBeGreaterThan(0)
  })
})
