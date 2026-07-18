import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  renderIrDigest,
  validateRenderIr,
  type CanonicalRenderIr,
  type RenderIrEffect
} from './render-ir.js'
import type { Rational } from './schema.js'
import { containsNullOrLineBreak } from '../text-safety.js'

export const ADVANCED_RENDER_LIMITS = Object.freeze({
  capabilityEntries: 256,
  gpuDevices: 8,
  effectNodes: 128,
  issues: 64,
  width: 16_384,
  height: 16_384,
  fps: 240,
  audioChannels: 16,
  canonicalBytes: 256 * 1024
})

export type RenderAccelerationPreference = 'cpu' | 'prefer-gpu' | 'require-gpu'
export type AdvancedExportFormat = 'h264-mp4' | 'h265-mp4' | 'prores-mov'
export type NegotiatedExportFormat = AdvancedExportFormat | 'ffv1-mkv'
export type AdvancedExportQuality = 'draft' | 'balanced' | 'high' | 'master'
export type AdvancedAudioCodec = 'aac' | 'pcm-s24' | 'flac'

export type RenderPerformanceLimits = {
  maxWidth: number
  maxHeight: number
  maxPixelsPerFrame: number
  maxFps: number
  maxDurationFrames: number
  maxEffectNodes: number
  maxMegapixelFrames: number
}

export type GpuRenderDeviceCapabilities = {
  id: string
  api: 'metal' | 'cuda' | 'opencl' | 'qsv' | 'vaapi'
  filters: string[]
  encoders: string[]
  maxPixelsPerFrame: number
  maxFps: number
}

export type AdvancedRenderCapabilities = {
  id: string
  version: string
  encoders: string[]
  muxers: string[]
  filters: string[]
  effects: string[]
  colorSpaces: string[]
  gpuDevices: GpuRenderDeviceCapabilities[]
  limits: RenderPerformanceLimits
}

export type AdvancedRenderIssue = {
  nodeId: string
  capability: string
  message: string
  guidance: string
}

export type AdvancedEffectStep = {
  effectId: string
  effectType: string
  filter: string
  complexity: number
}

export type AdvancedEffectLayerPlan = {
  layerId: string
  engine: 'cpu' | 'gpu'
  deviceId?: string
  filters: AdvancedEffectStep[]
  filterChain: string
}

export type AdvancedEffectExecutionPlan = {
  supported: boolean
  target: 'preview' | 'export'
  projectId: string
  sequenceId: string
  revision: number
  renderIrDigest: string
  capabilitiesDigest: string
  renderSemanticsDigest: string
  acceleration: {
    requested: RenderAccelerationPreference
    selected: 'cpu' | 'gpu'
    deviceId?: string
    fellBackToCpu: boolean
  }
  performance: {
    width: number
    height: number
    fps: number
    durationFrames: number
    effectNodes: number
    megapixelFrames: number
    weightedMegapixelFrames: number
  }
  layers: AdvancedEffectLayerPlan[]
  warnings: AdvancedRenderIssue[]
  issues: AdvancedRenderIssue[]
}

export type AdvancedExportSettings = {
  format: AdvancedExportFormat
  width: number
  height: number
  frameRate: Rational
  quality: AdvancedExportQuality
  acceleration: RenderAccelerationPreference
  allowPortableEquivalent?: boolean
  audio?: {
    codec: AdvancedAudioCodec
    sampleRate: 44_100 | 48_000 | 96_000
    channels: number
    bitrateKbps?: number
  }
}

export type AdvancedExportCapabilityEvidence = {
  requestedFormat: AdvancedExportFormat
  selectedFormat?: NegotiatedExportFormat
  selectedEncoder?: string
  selectedMuxer?: string
  encoderCandidates: string[]
  advertisedEncoders: string[]
  advertisedMuxers: string[]
  gpuDeviceId?: string
  portableEquivalent: boolean
}

export type AdvancedExportPlan = {
  supported: boolean
  projectId: string
  sequenceId: string
  revision: number
  renderIrDigest: string
  capabilitiesDigest: string
  settingsDigest: string
  requested: AdvancedExportSettings
  selected?: {
    format: NegotiatedExportFormat
    encoder: string
    muxer: string
    extension: 'mp4' | 'mov' | 'mkv'
    mime: 'video/mp4' | 'video/quicktime' | 'video/x-matroska'
    hardwareAccelerated: boolean
    gpuDeviceId?: string
    videoFilterSuffix: string[]
    videoArgs: string[]
    audioArgs: string[]
    muxerArgs: string[]
  }
  capabilityEvidence: AdvancedExportCapabilityEvidence
  warnings: AdvancedRenderIssue[]
  issues: AdvancedRenderIssue[]
}

type EffectCatalogEntry = {
  cpuFilter: string
  gpuFilter?: string
  complexity: number
  compile(parameters: Readonly<Record<string, number | string | boolean>>, filter: string): string
}

const EFFECT_CATALOG: Readonly<Record<string, EffectCatalogEntry>> = Object.freeze({
  'color.basic': {
    cpuFilter: 'eq',
    complexity: 1.25,
    compile(parameters, filter) {
      const values = exactNumericParameters(parameters, {
        brightness: [-1, 1, 0],
        contrast: [0, 2, 1],
        saturation: [0, 3, 1],
        gamma: [0.1, 10, 1]
      })
      return `${filter}=brightness=${decimal(values.brightness!)}:contrast=${decimal(values.contrast!)}:` +
        `saturation=${decimal(values.saturation!)}:gamma=${decimal(values.gamma!)}`
    }
  },
  'color.temperature': {
    cpuFilter: 'colorbalance',
    complexity: 1.5,
    compile(parameters, filter) {
      const values = exactNumericParameters(parameters, {
        temperature: [-1, 1, 0],
        tint: [-1, 1, 0]
      })
      const temperature = values.temperature!
      const tint = values.tint!
      return `${filter}=rs=${decimal(temperature)}:bs=${decimal(-temperature)}:` +
        `gm=${decimal(tint)}`
    }
  },
  blur: {
    cpuFilter: 'boxblur',
    gpuFilter: 'avgblur_opencl',
    complexity: 2.5,
    compile(parameters, filter) {
      const values = exactNumericParameters(parameters, { radius: [0, 100, 2] })
      const radius = Math.max(1, Math.round(values.radius!))
      return filter === 'avgblur_opencl'
        ? `${filter}=sizeX=${radius}:sizeY=${radius}`
        : `${filter}=luma_radius=${radius}:luma_power=1:chroma_radius=${radius}:chroma_power=1`
    }
  },
  sharpen: {
    cpuFilter: 'unsharp',
    gpuFilter: 'unsharp_opencl',
    complexity: 2,
    compile(parameters, filter) {
      const values = exactNumericParameters(parameters, { amount: [0, 5, 1] })
      return filter === 'unsharp_opencl'
        ? `${filter}=luma_msize_x=5:luma_msize_y=5:luma_amount=${decimal(values.amount!)}`
        : `${filter}=5:5:${decimal(values.amount!)}:5:5:0`
    }
  },
  vignette: {
    cpuFilter: 'vignette',
    complexity: 1.75,
    compile(parameters, filter) {
      const values = exactNumericParameters(parameters, { intensity: [0, 1, 0.35] })
      const angle = Math.PI / 2 - values.intensity! * Math.PI / 3
      return `${filter}=angle=${angle.toFixed(6)}`
    }
  }
})

export function baselineAdvancedFfmpegCapabilities(): AdvancedRenderCapabilities {
  return {
    id: 'ffmpeg',
    version: 'negotiated',
    encoders: ['aac', 'ffv1', 'flac', 'libx264', 'libx265', 'pcm_s24le', 'prores_ks'],
    muxers: ['matroska', 'mov', 'mp4'],
    filters: ['avgblur_opencl', 'boxblur', 'colorbalance', 'eq', 'unsharp', 'unsharp_opencl', 'vignette'],
    effects: Object.keys(EFFECT_CATALOG).sort(),
    colorSpaces: ['bt709'],
    gpuDevices: [],
    limits: {
      maxWidth: 8_192,
      maxHeight: 8_192,
      maxPixelsPerFrame: 33_554_432,
      maxFps: 120,
      maxDurationFrames: 2_592_000,
      maxEffectNodes: ADVANCED_RENDER_LIMITS.effectNodes,
      maxMegapixelFrames: 20_000_000
    }
  }
}

export function advancedRenderCapabilitiesDigest(capabilities: AdvancedRenderCapabilities): string {
  validateCapabilities(capabilities)
  return digest({
    ...capabilities,
    encoders: normalizedStrings(capabilities.encoders),
    muxers: normalizedStrings(capabilities.muxers),
    filters: normalizedStrings(capabilities.filters),
    effects: normalizedStrings(capabilities.effects),
    colorSpaces: normalizedStrings(capabilities.colorSpaces),
    gpuDevices: [...capabilities.gpuDevices]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((device) => ({
        ...device,
        filters: normalizedStrings(device.filters),
        encoders: normalizedStrings(device.encoders)
      }))
  })
}

export function negotiateAdvancedEffects(
  ir: CanonicalRenderIr,
  capabilities: AdvancedRenderCapabilities,
  request: {
    target: 'preview' | 'export'
    acceleration: RenderAccelerationPreference
  }
): AdvancedEffectExecutionPlan {
  validateRenderIr(ir)
  validateCapabilities(capabilities)
  if (!['preview', 'export'].includes(request.target)) invalid('Advanced effect target is invalid')
  if (!['cpu', 'prefer-gpu', 'require-gpu'].includes(request.acceleration)) {
    invalid('Advanced effect acceleration preference is invalid')
  }
  const issues: AdvancedRenderIssue[] = []
  const warnings: AdvancedRenderIssue[] = []
  const enabled = ir.layers.flatMap((layer) => layer.effects
    .filter((effect) => effect.enabled)
    .map((effect) => ({ layerId: layer.id, effect })))
  const metrics = renderPerformance(ir, enabled.map(({ effect }) => effect))
  addPerformanceIssues(ir, capabilities.limits, metrics, issues)
  if (!capabilities.colorSpaces.includes(ir.canvas.colorSpace)) {
    pushIssue(issues, renderIssue(
      'canvas', `color-space:${ir.canvas.colorSpace}`,
      `Backend ${capabilities.id} does not advertise ${ir.canvas.colorSpace} output.`,
      'Select a color-managed backend or explicitly convert the project before export.'
    ))
  }
  const cpuAvailable = enabled.every(({ effect }) => {
    const catalog = EFFECT_CATALOG[effect.type]
    return Boolean(catalog && capabilities.effects.includes(effect.type) && capabilities.filters.includes(catalog.cpuFilter))
  })
  const gpuDevice = request.acceleration === 'cpu'
    ? undefined
    : capabilities.gpuDevices.find((device) =>
      metrics.width * metrics.height <= device.maxPixelsPerFrame &&
      metrics.fps <= device.maxFps &&
      enabled.every(({ effect }) => {
        const catalog = EFFECT_CATALOG[effect.type]
        return Boolean(
          catalog?.gpuFilter &&
          capabilities.effects.includes(effect.type) &&
          device.filters.includes(catalog.gpuFilter)
        )
      }))
  if (request.acceleration === 'require-gpu' && !gpuDevice && enabled.length > 0) {
    pushIssue(issues, renderIssue(
      'backend', 'acceleration:gpu',
      'No single advertised GPU device can execute every enabled effect within its performance limits.',
      'Use prefer-gpu to allow the deterministic CPU fallback, simplify effects, or select another device.'
    ))
  }
  if (!cpuAvailable && !gpuDevice) {
    for (const { layerId, effect } of enabled) {
      const catalog = EFFECT_CATALOG[effect.type]
      if (!catalog) {
        pushIssue(issues, renderIssue(
          effect.id, `effect:${effect.type}`,
          `Effect ${effect.type} on ${layerId} is outside the bounded advanced-effect catalog.`,
          'Disable the effect, bake it to a proxy, or install an adapter that explicitly implements it.'
        ))
      } else if (!capabilities.effects.includes(effect.type)) {
        pushIssue(issues, renderIssue(
          effect.id, `effect:${effect.type}`,
          `Backend ${capabilities.id} does not advertise effect ${effect.type}.`,
          'Select a backend advertising the effect or disable it.'
        ))
      } else if (!capabilities.filters.includes(catalog.cpuFilter)) {
        pushIssue(issues, renderIssue(
          effect.id, `filter:${catalog.cpuFilter}`,
          `The CPU fallback for ${effect.type} requires ${catalog.cpuFilter}.`,
          `Install an FFmpeg build with ${catalog.cpuFilter} or use a compatible GPU device.`
        ))
      }
    }
  }
  const selectedGpu = Boolean(gpuDevice && request.acceleration !== 'cpu' && issues.length === 0)
  const fellBackToCpu = request.acceleration === 'prefer-gpu' && enabled.length > 0 && !selectedGpu
  if (fellBackToCpu && cpuAvailable) {
    warnings.push(renderIssue(
      'backend', 'fallback:cpu',
      'The requested GPU path cannot execute the complete effect chain; the entire chain will use the deterministic CPU fallback.',
      'This is expected and preserves preview/export semantics; choose a capable GPU backend to accelerate it.'
    ))
  }
  const layers: AdvancedEffectLayerPlan[] = []
  for (const layer of ir.layers) {
    const effects = layer.effects.filter((effect) => effect.enabled)
    if (effects.length === 0) continue
    const steps: AdvancedEffectStep[] = []
    for (const effect of effects) {
      const catalog = EFFECT_CATALOG[effect.type]
      if (!catalog) continue
      const filter = selectedGpu ? catalog.gpuFilter : catalog.cpuFilter
      if (!filter) continue
      try {
        steps.push({
          effectId: effect.id,
          effectType: effect.type,
          filter: catalog.compile(effect.parameters, filter),
          complexity: catalog.complexity
        })
      } catch (error) {
        pushIssue(issues, renderIssue(
          effect.id, `effect-parameters:${effect.type}`,
          error instanceof Error ? error.message : `Invalid parameters for ${effect.type}.`,
          'Use only the documented bounded parameters for this effect.'
        ))
      }
    }
    const filters = steps.map(({ filter }) => filter)
    layers.push({
      layerId: layer.id,
      engine: selectedGpu ? 'gpu' : 'cpu',
      ...(selectedGpu && gpuDevice ? { deviceId: gpuDevice.id } : {}),
      filters: steps,
      filterChain: selectedGpu
        ? ['format=rgba', 'hwupload', ...filters, 'hwdownload', 'format=yuv420p'].join(',')
        : filters.join(',')
    })
  }
  const capabilitiesDigest = advancedRenderCapabilitiesDigest(capabilities)
  const semantics = {
    irDigest: renderIrDigest(ir),
    capabilitiesDigest,
    acceleration: selectedGpu ? { engine: 'gpu', deviceId: gpuDevice!.id } : { engine: 'cpu' },
    layers
  }
  return {
    supported: issues.length === 0,
    target: request.target,
    projectId: ir.projectId,
    sequenceId: ir.sequenceId,
    revision: ir.revision,
    renderIrDigest: renderIrDigest(ir),
    capabilitiesDigest,
    renderSemanticsDigest: digest(semantics),
    acceleration: {
      requested: request.acceleration,
      selected: selectedGpu ? 'gpu' : 'cpu',
      ...(selectedGpu && gpuDevice ? { deviceId: gpuDevice.id } : {}),
      fellBackToCpu
    },
    performance: metrics,
    layers,
    warnings,
    issues
  }
}

export function negotiateAdvancedExport(
  ir: CanonicalRenderIr,
  settings: AdvancedExportSettings,
  capabilities: AdvancedRenderCapabilities
): AdvancedExportPlan {
  validateRenderIr(ir)
  validateCapabilities(capabilities)
  validateExportSettings(settings)
  const issues: AdvancedRenderIssue[] = []
  const warnings: AdvancedRenderIssue[] = []
  const fps = rationalValue(settings.frameRate)
  const outputMetrics = {
    width: settings.width,
    height: settings.height,
    fps,
    durationFrames: ir.range.endFrame - ir.range.startFrame,
    effectNodes: ir.layers.reduce((total, layer) => total + layer.effects.filter(({ enabled }) => enabled).length, 0),
    megapixelFrames: settings.width * settings.height / 1_000_000 * (ir.range.endFrame - ir.range.startFrame),
    weightedMegapixelFrames: 0
  }
  outputMetrics.weightedMegapixelFrames = outputMetrics.megapixelFrames * Math.max(1, outputMetrics.effectNodes)
  addPerformanceIssues(ir, capabilities.limits, outputMetrics, issues)
  const requestedCandidates = formatCandidates(settings.format, settings.acceleration)
  let candidates = requestedCandidates
  let portableEquivalent = false
  let selectedFormat: NegotiatedExportFormat = settings.format
  const deviceWorkload = { pixelsPerFrame: settings.width * settings.height, fps }
  let selected = selectEncoder(candidates, capabilities, settings.acceleration, deviceWorkload)
  if (!selected && settings.allowPortableEquivalent) {
    const fallback = portableCandidates(settings.format, settings.acceleration)
    selected = selectEncoder(fallback.candidates, capabilities, settings.acceleration, deviceWorkload)
    if (selected) {
      selectedFormat = fallback.format
      candidates = fallback.candidates
      portableEquivalent = true
      warnings.push(renderIssue(
        'export', `fallback:${selectedFormat}`,
        `${settings.format} is unavailable; ${selectedFormat} was selected as an explicit portable equivalent.`,
        'Review the selected codec/container before starting the export.'
      ))
    }
  }
  if (!selected) {
    pushIssue(issues, renderIssue(
      'export', `codec:${settings.format}`,
      `No advertised encoder satisfies ${settings.format} with acceleration policy ${settings.acceleration}.`,
      settings.allowPortableEquivalent
        ? 'Install a supported encoder or select another backend.'
        : 'Install a supported encoder or explicitly allow a portable equivalent.'
    ))
  }
  if (selected && settings.acceleration === 'prefer-gpu' && !selected.device) {
    warnings.push(renderIssue(
      'export', 'fallback:cpu-encoder',
      `No compatible hardware encoder is available; ${selected.encoder} will encode on the CPU.`,
      'The output settings remain unchanged; select a compatible GPU backend for acceleration.'
    ))
  }
  const muxer = muxerFor(selectedFormat)
  if (!capabilities.muxers.includes(muxer)) {
    pushIssue(issues, renderIssue(
      'export', `muxer:${muxer}`,
      `Backend ${capabilities.id} does not advertise the ${muxer} muxer.`,
      'Install a backend with the required muxer or choose a compatible output format.'
    ))
  }
  const audioEncoder = settings.audio ? audioEncoderFor(settings.audio.codec) : undefined
  if (audioEncoder && !capabilities.encoders.includes(audioEncoder)) {
    pushIssue(issues, renderIssue(
      'audio', `codec:${audioEncoder}`,
      `Backend ${capabilities.id} does not advertise audio encoder ${audioEncoder}.`,
      'Choose an available audio codec or install a backend with the requested encoder.'
    ))
  }
  if (settings.audio && muxer === 'mp4' && settings.audio.codec !== 'aac') {
    pushIssue(issues, renderIssue(
      'audio', `container-audio:${muxer}/${settings.audio.codec}`,
      `Audio codec ${settings.audio.codec} is not allowed by the bounded MP4 profile.`,
      'Use AAC for MP4, or select ProRes MOV / FFV1 MKV for lossless audio.'
    ))
  }
  const capabilitiesDigest = advancedRenderCapabilitiesDigest(capabilities)
  const settingsDigest = digest(settings)
  const evidence: AdvancedExportCapabilityEvidence = {
    requestedFormat: settings.format,
    ...(selected ? {
      selectedFormat,
      selectedEncoder: selected.encoder,
      selectedMuxer: muxer,
      ...(selected.device ? { gpuDeviceId: selected.device.id } : {})
    } : {}),
    encoderCandidates: candidates.map(({ encoder }) => encoder),
    advertisedEncoders: normalizedStrings(capabilities.encoders),
    advertisedMuxers: normalizedStrings(capabilities.muxers),
    portableEquivalent
  }
  return {
    supported: issues.length === 0,
    projectId: ir.projectId,
    sequenceId: ir.sequenceId,
    revision: ir.revision,
    renderIrDigest: renderIrDigest(ir),
    capabilitiesDigest,
    settingsDigest,
    requested: structuredClone(settings),
    ...(selected && issues.length === 0 ? {
      selected: {
        format: selectedFormat,
        encoder: selected.encoder,
        muxer,
        extension: extensionFor(selectedFormat),
        mime: mimeFor(selectedFormat),
        hardwareAccelerated: Boolean(selected.device),
        ...(selected.device ? { gpuDeviceId: selected.device.id } : {}),
        videoFilterSuffix: [
          `scale=${settings.width}:${settings.height}:flags=lanczos`,
          `fps=${settings.frameRate.numerator}/${settings.frameRate.denominator}`
        ],
        videoArgs: videoEncoderArgs(selected.encoder, selectedFormat, settings.quality),
        audioArgs: settings.audio ? audioArgs(settings.audio) : ['-an'],
        muxerArgs: muxer === 'mp4'
          ? ['-movflags', '+faststart', '-f', 'mp4']
          : ['-f', muxer]
      }
    } : {}),
    capabilityEvidence: evidence,
    warnings,
    issues
  }
}

export function assertAdvancedRenderSupported(
  plan: AdvancedEffectExecutionPlan | AdvancedExportPlan
): void {
  if (plan.supported) return
  throw engineError(
    'render_unsupported',
    `Advanced render negotiation failed: ${plan.issues.map(({ nodeId, capability }) => `${nodeId} (${capability})`).join(', ')}`,
    { issues: plan.issues }
  )
}

type EncoderCandidate = {
  encoder: string
  hardwareApi?: GpuRenderDeviceCapabilities['api']
}

function formatCandidates(
  format: AdvancedExportFormat,
  acceleration: RenderAccelerationPreference
): EncoderCandidate[] {
  const gpu = format === 'h264-mp4'
    ? [
        { encoder: 'h264_videotoolbox', hardwareApi: 'metal' as const },
        { encoder: 'h264_nvenc', hardwareApi: 'cuda' as const },
        { encoder: 'h264_qsv', hardwareApi: 'qsv' as const },
        { encoder: 'h264_vaapi', hardwareApi: 'vaapi' as const }
      ]
    : format === 'h265-mp4'
      ? [
          { encoder: 'hevc_videotoolbox', hardwareApi: 'metal' as const },
          { encoder: 'hevc_nvenc', hardwareApi: 'cuda' as const },
          { encoder: 'hevc_qsv', hardwareApi: 'qsv' as const },
          { encoder: 'hevc_vaapi', hardwareApi: 'vaapi' as const }
        ]
      : [{ encoder: 'prores_videotoolbox', hardwareApi: 'metal' as const }]
  const cpu = format === 'h264-mp4'
    ? [{ encoder: 'libx264' }]
    : format === 'h265-mp4'
      ? [{ encoder: 'libx265' }]
      : [{ encoder: 'prores_ks' }]
  return acceleration === 'cpu' ? cpu : acceleration === 'require-gpu' ? gpu : [...gpu, ...cpu]
}

function portableCandidates(
  format: AdvancedExportFormat,
  acceleration: RenderAccelerationPreference
): { format: NegotiatedExportFormat; candidates: EncoderCandidate[] } {
  if (format === 'prores-mov') return { format: 'ffv1-mkv', candidates: [{ encoder: 'ffv1' }] }
  if (format === 'h265-mp4') return { format: 'h264-mp4', candidates: formatCandidates('h264-mp4', acceleration) }
  return { format: 'ffv1-mkv', candidates: [{ encoder: 'ffv1' }] }
}

function selectEncoder(
  candidates: readonly EncoderCandidate[],
  capabilities: AdvancedRenderCapabilities,
  acceleration: RenderAccelerationPreference,
  workload: { pixelsPerFrame: number; fps: number }
): { encoder: string; device?: GpuRenderDeviceCapabilities } | undefined {
  for (const candidate of candidates) {
    if (!capabilities.encoders.includes(candidate.encoder)) continue
    if (!candidate.hardwareApi) {
      if (acceleration === 'require-gpu') continue
      return { encoder: candidate.encoder }
    }
    const device = capabilities.gpuDevices.find((entry) =>
      entry.api === candidate.hardwareApi &&
      entry.encoders.includes(candidate.encoder) &&
      workload.pixelsPerFrame <= entry.maxPixelsPerFrame &&
      workload.fps <= entry.maxFps)
    if (device) return { encoder: candidate.encoder, device }
  }
  return undefined
}

function videoEncoderArgs(
  encoder: string,
  format: NegotiatedExportFormat,
  quality: AdvancedExportQuality
): string[] {
  if (encoder === 'libx264' || encoder === 'libx265') {
    const crf = quality === 'draft' ? 30 : quality === 'balanced' ? 24 : quality === 'high' ? 19 : 14
    const preset = quality === 'draft' ? 'fast' : quality === 'master' ? 'slow' : 'medium'
    return [
      '-c:v', encoder,
      '-preset', preset,
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
      ...(encoder === 'libx265' ? ['-tag:v', 'hvc1'] : [])
    ]
  }
  if (encoder === 'prores_ks' || encoder === 'prores_videotoolbox') {
    const profile = quality === 'draft' ? '0' : quality === 'balanced' ? '1' : quality === 'high' ? '2' : '3'
    return ['-c:v', encoder, '-profile:v', profile, '-pix_fmt', 'yuv422p10le']
  }
  if (encoder === 'ffv1') return ['-c:v', 'ffv1', '-level', '3', '-coder', '1', '-context', '1', '-pix_fmt', 'yuv422p10le']
  const qualityValue = quality === 'draft' ? '45' : quality === 'balanced' ? '60' : quality === 'high' ? '75' : '90'
  const base = ['-c:v', encoder, '-q:v', qualityValue, '-pix_fmt', 'yuv420p']
  return format === 'h265-mp4' ? [...base, '-tag:v', 'hvc1'] : base
}

function audioArgs(audio: NonNullable<AdvancedExportSettings['audio']>): string[] {
  const encoder = audioEncoderFor(audio.codec)
  return [
    '-c:a', encoder,
    '-ar', String(audio.sampleRate),
    '-ac', String(audio.channels),
    ...(audio.codec === 'aac' ? ['-b:a', `${audio.bitrateKbps ?? 192}k`] : [])
  ]
}

function audioEncoderFor(codec: AdvancedAudioCodec): string {
  return codec === 'pcm-s24' ? 'pcm_s24le' : codec
}

function muxerFor(format: NegotiatedExportFormat): 'mp4' | 'mov' | 'matroska' {
  return format === 'prores-mov' ? 'mov' : format === 'ffv1-mkv' ? 'matroska' : 'mp4'
}

function extensionFor(format: NegotiatedExportFormat): 'mp4' | 'mov' | 'mkv' {
  return format === 'prores-mov' ? 'mov' : format === 'ffv1-mkv' ? 'mkv' : 'mp4'
}

function mimeFor(format: NegotiatedExportFormat): 'video/mp4' | 'video/quicktime' | 'video/x-matroska' {
  return format === 'prores-mov'
    ? 'video/quicktime'
    : format === 'ffv1-mkv'
      ? 'video/x-matroska'
      : 'video/mp4'
}

function renderPerformance(
  ir: CanonicalRenderIr,
  effects: readonly RenderIrEffect[]
): AdvancedEffectExecutionPlan['performance'] {
  const width = ir.canvas.width
  const height = ir.canvas.height
  const fps = rationalValue(ir.fps)
  const durationFrames = ir.range.endFrame - ir.range.startFrame
  const megapixelFrames = width * height / 1_000_000 * durationFrames
  const complexity = effects.reduce((total, effect) => total + (EFFECT_CATALOG[effect.type]?.complexity ?? 4), 1)
  return {
    width,
    height,
    fps,
    durationFrames,
    effectNodes: effects.length,
    megapixelFrames,
    weightedMegapixelFrames: megapixelFrames * complexity
  }
}

function addPerformanceIssues(
  ir: CanonicalRenderIr,
  limits: RenderPerformanceLimits,
  metrics: AdvancedEffectExecutionPlan['performance'],
  issues: AdvancedRenderIssue[]
): void {
  const checks: Array<[boolean, string, string, string]> = [
    [metrics.width <= limits.maxWidth, 'limit:width', `Output width ${metrics.width} exceeds ${limits.maxWidth}.`, 'Reduce output width or use a backend with a larger frame limit.'],
    [metrics.height <= limits.maxHeight, 'limit:height', `Output height ${metrics.height} exceeds ${limits.maxHeight}.`, 'Reduce output height or use a backend with a larger frame limit.'],
    [metrics.width * metrics.height <= limits.maxPixelsPerFrame, 'limit:pixels', 'Output pixels per frame exceed the backend limit.', 'Reduce resolution or use a higher-capacity backend.'],
    [metrics.fps <= limits.maxFps, 'limit:fps', `Output frame rate ${metrics.fps} exceeds ${limits.maxFps}.`, 'Reduce frame rate or use a backend with a higher frame-rate limit.'],
    [metrics.durationFrames <= limits.maxDurationFrames, 'limit:duration', 'Render duration exceeds the backend frame limit.', 'Split the render range or use a backend with a larger duration limit.'],
    [metrics.effectNodes <= limits.maxEffectNodes, 'limit:effects', 'Enabled effect count exceeds the backend limit.', 'Disable or bake effects before rendering.'],
    [metrics.weightedMegapixelFrames <= limits.maxMegapixelFrames, 'limit:workload', 'Estimated render workload exceeds the bounded performance budget.', 'Lower resolution, duration, or effect complexity, then retry.']
  ]
  for (const [passes, capability, message, guidance] of checks) {
    if (!passes) pushIssue(issues, renderIssue(ir.sequenceId, capability, message, guidance))
  }
}

function validateCapabilities(capabilities: AdvancedRenderCapabilities): void {
  boundedString(capabilities.id, 'capabilities.id', 128)
  boundedString(capabilities.version, 'capabilities.version', 128)
  for (const [label, values] of Object.entries({
    encoders: capabilities.encoders,
    muxers: capabilities.muxers,
    filters: capabilities.filters,
    effects: capabilities.effects,
    colorSpaces: capabilities.colorSpaces
  })) {
    if (!Array.isArray(values) || values.length > ADVANCED_RENDER_LIMITS.capabilityEntries) {
      invalid(`capabilities.${label} exceeds its bound`)
    }
    values.forEach((value) => boundedString(value, `capabilities.${label}`, 128))
  }
  if (capabilities.gpuDevices.length > ADVANCED_RENDER_LIMITS.gpuDevices) invalid('GPU device catalog exceeds its bound')
  for (const device of capabilities.gpuDevices) {
    boundedString(device.id, 'gpuDevice.id', 128)
    if (!['metal', 'cuda', 'opencl', 'qsv', 'vaapi'].includes(device.api)) invalid('GPU device API is invalid')
    device.filters.forEach((value) => boundedString(value, 'gpuDevice.filters', 128))
    device.encoders.forEach((value) => boundedString(value, 'gpuDevice.encoders', 128))
    positiveInteger(device.maxPixelsPerFrame, 'gpuDevice.maxPixelsPerFrame')
    positiveNumber(device.maxFps, 'gpuDevice.maxFps')
  }
  const limits = capabilities.limits
  positiveInteger(limits.maxWidth, 'limits.maxWidth')
  positiveInteger(limits.maxHeight, 'limits.maxHeight')
  positiveInteger(limits.maxPixelsPerFrame, 'limits.maxPixelsPerFrame')
  positiveNumber(limits.maxFps, 'limits.maxFps')
  positiveInteger(limits.maxDurationFrames, 'limits.maxDurationFrames')
  positiveInteger(limits.maxEffectNodes, 'limits.maxEffectNodes')
  positiveNumber(limits.maxMegapixelFrames, 'limits.maxMegapixelFrames')
}

function validateExportSettings(settings: AdvancedExportSettings): void {
  if (!['h264-mp4', 'h265-mp4', 'prores-mov'].includes(settings.format)) invalid('Export format is invalid')
  positiveInteger(settings.width, 'export.width')
  positiveInteger(settings.height, 'export.height')
  if (settings.width > ADVANCED_RENDER_LIMITS.width || settings.height > ADVANCED_RENDER_LIMITS.height) {
    invalid('Export resolution exceeds the absolute safety limit')
  }
  if ((settings.format === 'h264-mp4' || settings.format === 'h265-mp4') && (settings.width % 2 || settings.height % 2)) {
    invalid('4:2:0 MP4 output requires even width and height')
  }
  positiveInteger(settings.frameRate.numerator, 'export.frameRate.numerator')
  positiveInteger(settings.frameRate.denominator, 'export.frameRate.denominator')
  if (rationalValue(settings.frameRate) > ADVANCED_RENDER_LIMITS.fps) invalid('Export frame rate exceeds the absolute safety limit')
  if (!['draft', 'balanced', 'high', 'master'].includes(settings.quality)) invalid('Export quality is invalid')
  if (!['cpu', 'prefer-gpu', 'require-gpu'].includes(settings.acceleration)) invalid('Export acceleration is invalid')
  if (settings.audio) {
    if (!['aac', 'pcm-s24', 'flac'].includes(settings.audio.codec)) invalid('Export audio codec is invalid')
    if (![44_100, 48_000, 96_000].includes(settings.audio.sampleRate)) invalid('Export audio sample rate is invalid')
    positiveInteger(settings.audio.channels, 'export.audio.channels')
    if (settings.audio.channels > ADVANCED_RENDER_LIMITS.audioChannels) invalid('Export audio channels exceed the limit')
    if (settings.audio.bitrateKbps !== undefined) {
      if (!Number.isSafeInteger(settings.audio.bitrateKbps) || settings.audio.bitrateKbps < 32 || settings.audio.bitrateKbps > 1_536) {
        invalid('Export audio bitrate must be between 32 and 1536 kbps')
      }
    }
  }
}

function exactNumericParameters(
  parameters: Readonly<Record<string, number | string | boolean>>,
  definitions: Readonly<Record<string, readonly [minimum: number, maximum: number, fallback: number]>>
): Record<string, number> {
  const unknown = Object.keys(parameters).filter((key) => !(key in definitions))
  if (unknown.length > 0) throw new Error(`Unsupported effect parameter(s): ${unknown.sort().join(', ')}`)
  const result: Record<string, number> = {}
  for (const [key, [minimum, maximum, fallback]] of Object.entries(definitions)) {
    const value = parameters[key] ?? fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error(`${key} must be a finite number between ${minimum} and ${maximum}`)
    }
    result[key] = value
  }
  return result
}

function rationalValue(value: Rational): number {
  return value.numerator / value.denominator
}

function decimal(value: number): string {
  const normalized = Math.abs(value) < 0.0000005 ? 0 : value
  return normalized.toFixed(6)
}

function renderIssue(
  nodeId: string,
  capability: string,
  message: string,
  guidance: string
): AdvancedRenderIssue {
  return { nodeId, capability, message, guidance }
}

function pushIssue(target: AdvancedRenderIssue[], value: AdvancedRenderIssue): void {
  if (target.length < ADVANCED_RENDER_LIMITS.issues) target.push(value)
}

function normalizedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function digest(value: unknown): string {
  const canonical = JSON.stringify(sortJson(value))
  if (Buffer.byteLength(canonical, 'utf8') > ADVANCED_RENDER_LIMITS.canonicalBytes) {
    invalid('Advanced render canonical evidence exceeds its byte limit')
  }
  return createHash('sha256').update(canonical).digest('hex')
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]))
  }
  return value
}

function boundedString(value: unknown, label: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || containsNullOrLineBreak(value)) {
    invalid(`${label} must be a bounded string`)
  }
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${label} must be a positive integer`)
}

function positiveNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(`${label} must be positive`)
}

function invalid(message: string): never {
  throw engineError('render_unsupported', message)
}
