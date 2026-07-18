import type { JsonObject, MediaCapabilities } from '@kun/extension-api'
import {
  advancedRenderCapabilitiesDigest,
  baselineAdvancedFfmpegCapabilities,
  defaultFfmpegCapabilities,
  type AdvancedRenderCapabilities,
  type RenderBackendCapabilities
} from '../engine/index.js'

const ENCODER_FEATURES = Object.freeze({
  libx264: 'libx264-encoder',
  libx265: 'libx265-encoder',
  prores_ks: 'prores-ks-encoder',
  ffv1: 'ffv1-encoder',
  aac: 'aac-encoder',
  flac: 'flac-encoder',
  pcm_s24le: 'pcm-s24-encoder'
} as const)

const FILTER_FEATURES = Object.freeze({
  eq: 'eq-filter',
  colorbalance: 'colorbalance-filter',
  boxblur: 'boxblur-filter',
  unsharp: 'unsharp-filter',
  vignette: 'vignette-filter'
} as const)

const MUXER_FEATURES = Object.freeze({
  mp4: 'mp4-muxer',
  mov: 'mov-muxer',
  matroska: 'matroska-muxer'
} as const)

const EFFECT_FILTERS = Object.freeze({
  'color.basic': 'eq',
  'color.temperature': 'colorbalance',
  blur: 'boxblur',
  sharpen: 'unsharp',
  vignette: 'vignette'
} as const)

/**
 * Converts the generic Host probe into the bounded capability inventory used
 * by the video engine. No encoder, muxer, filter, or GPU device is inferred
 * from the operating system: only reviewed probe features are advertised.
 */
export function observedAdvancedFfmpegCapabilities(
  media: MediaCapabilities
): AdvancedRenderCapabilities {
  const baseline = baselineAdvancedFfmpegCapabilities()
  const features = new Set<string>(media.ffmpeg.features)
  const encoders = Object.entries(ENCODER_FEATURES)
    .filter(([, feature]) => features.has(feature))
    .map(([encoder]) => encoder)
  const filters = Object.entries(FILTER_FEATURES)
    .filter(([, feature]) => features.has(feature))
    .map(([filter]) => filter)
  const muxers = Object.entries(MUXER_FEATURES)
    .filter(([, feature]) => features.has(feature))
    .map(([muxer]) => muxer)
  const filterSet = new Set(filters)
  return {
    ...baseline,
    version: media.ffmpeg.version ?? 'unknown',
    encoders: media.ffmpeg.available ? encoders : [],
    muxers: media.ffmpeg.available ? muxers : [],
    filters: media.ffmpeg.available ? filters : [],
    effects: media.ffmpeg.available
      ? Object.entries(EFFECT_FILTERS)
        .filter(([, filter]) => filterSet.has(filter))
        .map(([effect]) => effect)
      : [],
    // The public broker does not currently expose a reviewed device/session
    // binding. Reporting no device makes require-gpu fail and prefer-gpu use
    // the deterministic CPU path instead of guessing from a platform name.
    gpuDevices: []
  }
}

export function observedRenderBackendCapabilities(
  media: MediaCapabilities,
  advanced: AdvancedRenderCapabilities = observedAdvancedFfmpegCapabilities(media)
): RenderBackendCapabilities {
  const profile = defaultFfmpegCapabilities()
  const features = new Set<string>(media.ffmpeg.features)
  const encoders = new Set(advanced.encoders)
  return {
    ...profile,
    version: media.ffmpeg.version ?? 'unknown',
    codecs: media.ffmpeg.available
      ? [
          'png',
          ...(encoders.has('libx264') ? ['h264'] : []),
          ...(encoders.has('libx265') ? ['h265'] : []),
          ...(encoders.has('prores_ks') ? ['prores'] : []),
          ...(encoders.has('ffv1') ? ['ffv1'] : []),
          ...(encoders.has('aac') ? ['aac'] : [])
        ]
      : [],
    filters: media.ffmpeg.available
      ? profile.filters.filter((filter) =>
          filter !== 'drawtext' || features.has('drawtext-filter'))
      : [],
    effects: [...advanced.effects],
    fonts: media.ffmpeg.available && features.has('drawtext-filter') ? ['sans-serif'] : []
  }
}

export function professionalExportCapabilityProjection(
  media: MediaCapabilities
): JsonObject {
  const capabilities = observedAdvancedFfmpegCapabilities(media)
  const encoders = new Set(capabilities.encoders)
  const muxers = new Set(capabilities.muxers)
  const formats = {
    'h264-mp4': encoders.has('libx264') && muxers.has('mp4'),
    'h265-mp4': encoders.has('libx265') && muxers.has('mp4'),
    'prores-mov': encoders.has('prores_ks') && muxers.has('mov'),
    'ffv1-mkv': encoders.has('ffv1') && muxers.has('matroska')
  }
  return {
    schemaVersion: 1,
    probedAt: media.probedAt,
    backend: {
      id: capabilities.id,
      version: capabilities.version,
      available: media.ffmpeg.available,
      capabilitiesDigest: advancedRenderCapabilitiesDigest(capabilities)
    },
    formats,
    audioCodecs: {
      aac: encoders.has('aac'),
      flac: encoders.has('flac'),
      'pcm-s24': encoders.has('pcm_s24le')
    },
    effects: Object.fromEntries(
      Object.keys(EFFECT_FILTERS).sort().map((effect) => [effect, capabilities.effects.includes(effect)])
    ),
    acceleration: {
      cpu: media.ffmpeg.available,
      preferGpuFallsBackToCpu: media.ffmpeg.available,
      gpuAvailable: false,
      reason: 'No reviewed GPU device/session binding is exposed by the public media broker.'
    },
    performanceLimits: capabilities.limits
  }
}
