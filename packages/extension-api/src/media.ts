import { z } from 'zod'
import { JsonObjectSchema, RelativePathSchema } from './common.js'
import { JobReferenceSchema } from './jobs.js'

const OpaqueMediaReferenceSchema = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/, 'Expected an opaque media reference')

function containsAsciiControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export const MediaHandleIdSchema = OpaqueMediaReferenceSchema
export type MediaHandleId = z.infer<typeof MediaHandleIdSchema>

export const MediaLeaseIdSchema = OpaqueMediaReferenceSchema
export type MediaLeaseId = z.infer<typeof MediaLeaseIdSchema>

export const MediaKindSchema = z.enum(['video', 'audio', 'image', 'subtitle', 'data', 'unknown'])
export type MediaKind = z.infer<typeof MediaKindSchema>

export const MediaHandleModeSchema = z.enum(['read', 'export'])
export type MediaHandleMode = z.infer<typeof MediaHandleModeSchema>

export const MediaMetadataSchema = z.strictObject({
  handleId: MediaHandleIdSchema,
  mode: MediaHandleModeSchema,
  kind: MediaKindSchema,
  displayName: z.string().min(1).max(256),
  mimeType: z
    .string()
    .min(3)
    .max(128)
    .regex(new RegExp('^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$'))
    .optional(),
  byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  modifiedAt: z.string().datetime().optional(),
  /** Runtime-owned successful lease access used by quota/LRU brokers. */
  lastAccessedAt: z.string().datetime().optional(),
  completionIdentity: z.string().min(1).max(512).optional(),
  workspaceRelativeDisplayLocation: RelativePathSchema.optional(),
  revoked: z.boolean().default(false)
})
export type MediaMetadata = z.infer<typeof MediaMetadataSchema>

export const MediaPickerFilterSchema = z.strictObject({
  name: z.string().min(1).max(128),
  extensions: z
    .array(z.string().min(1).max(32).regex(/^[A-Za-z0-9]+$/))
    .min(1)
    .max(64),
  mimeTypes: z
    .array(
      z.string().min(3).max(128).regex(new RegExp('^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+*-]+$'))
    )
    .max(64)
    .default([])
})
export type MediaPickerFilter = z.input<typeof MediaPickerFilterSchema>

export const MediaPickFilesRequestSchema = z.strictObject({
  filters: z.array(MediaPickerFilterSchema).max(32).default([]),
  multiple: z.boolean().default(false),
  maxFiles: z.number().int().min(1).max(128).default(1)
})
export type MediaPickFilesRequest = z.input<typeof MediaPickFilesRequestSchema>

export const MediaPickFilesResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('selected'), files: z.array(MediaMetadataSchema).min(1).max(128) }),
  z.strictObject({ outcome: z.literal('cancelled'), files: z.tuple([]) })
])
export type MediaPickFilesResult = z.infer<typeof MediaPickFilesResultSchema>

export const MediaPickSaveTargetRequestSchema = z.strictObject({
  suggestedName: z.string().min(1).max(256).optional(),
  filters: z.array(MediaPickerFilterSchema).max(32).default([])
})
export type MediaPickSaveTargetRequest = z.input<typeof MediaPickSaveTargetRequestSchema>

export const MediaPickSaveTargetResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('selected'), target: MediaMetadataSchema }),
  z.strictObject({ outcome: z.literal('cancelled') })
])
export type MediaPickSaveTargetResult = z.infer<typeof MediaPickSaveTargetResultSchema>

/**
 * Host-owned disposable output grants for derived/cache media. Unlike an
 * export picker grant, this never exposes or lets the extension choose a path.
 * The Host requires `media.process` and `workspace.write`; `media.export` is not
 * required merely to allocate this disposable grant.
 */
export const MediaCacheFormatSchema = z.enum(['png', 'jpeg', 'mp4', 'webm', 'wav'])
export type MediaCacheFormat = z.infer<typeof MediaCacheFormatSchema>

export const MediaCreateCacheTargetRequestSchema = z.strictObject({
  format: MediaCacheFormatSchema,
  purpose: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/)
})
export type MediaCreateCacheTargetRequest = z.infer<typeof MediaCreateCacheTargetRequestSchema>

export const MediaCreateCacheTargetResultSchema = z.strictObject({
  target: MediaMetadataSchema
})
export type MediaCreateCacheTargetResult = z.infer<typeof MediaCreateCacheTargetResultSchema>

export const MediaStatRequestSchema = z.strictObject({ handleId: MediaHandleIdSchema })
export type MediaStatRequest = z.infer<typeof MediaStatRequestSchema>

export const MAX_MEDIA_TEXT_BYTES = 2 * 1024 * 1024

export const MediaReadTextRequestSchema = z.strictObject({
  handleId: MediaHandleIdSchema,
  maxBytes: z.number().int().min(1).max(MAX_MEDIA_TEXT_BYTES).default(MAX_MEDIA_TEXT_BYTES)
})
export type MediaReadTextRequest = z.input<typeof MediaReadTextRequestSchema>

export const MediaReadTextResultSchema = z.strictObject({
  handleId: MediaHandleIdSchema,
  displayName: z.string().min(1).max(256),
  mimeType: z.string().min(3).max(128),
  byteSize: z.number().int().nonnegative().max(MAX_MEDIA_TEXT_BYTES),
  content: z.string().max(MAX_MEDIA_TEXT_BYTES)
}).superRefine((value, context) => {
  if (new TextEncoder().encode(value.content).byteLength !== value.byteSize) {
    context.addIssue({
      code: 'custom',
      message: 'Media text byteSize must match its UTF-8 content'
    })
  }
})
export type MediaReadTextResult = z.infer<typeof MediaReadTextResultSchema>

export const MediaReleaseRequestSchema = z.discriminatedUnion('resource', [
  z.strictObject({ resource: z.literal('handle'), handleId: MediaHandleIdSchema }),
  z.strictObject({ resource: z.literal('lease'), leaseId: MediaLeaseIdSchema })
])
export type MediaReleaseRequest = z.infer<typeof MediaReleaseRequestSchema>

export const MediaReleaseResultSchema = z.strictObject({ released: z.boolean() })
export type MediaReleaseResult = z.infer<typeof MediaReleaseResultSchema>

export const MediaOpenViewResourceRequestSchema = z.strictObject({
  handleId: MediaHandleIdSchema,
  contributionId: z.string().min(1).max(256).optional()
})
export type MediaOpenViewResourceRequest = z.infer<typeof MediaOpenViewResourceRequestSchema>

export const MediaResourceLeaseSchema = z.strictObject({
  leaseId: MediaLeaseIdSchema,
  handleId: MediaHandleIdSchema,
  url: z.string().min(24).max(2048).regex(new RegExp('^kun-media://')),
  mimeType: z.string().min(3).max(128),
  expiresAt: z.string().datetime()
})
export type MediaResourceLease = z.infer<typeof MediaResourceLeaseSchema>

export const RationalSchema = z.strictObject({
  numerator: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  denominator: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
export type Rational = z.infer<typeof RationalSchema>

export const MediaStreamDispositionSchema = z.strictObject({
  default: z.boolean().default(false),
  forced: z.boolean().default(false),
  attachedPicture: z.boolean().default(false)
})
export type MediaStreamDisposition = z.infer<typeof MediaStreamDispositionSchema>

export const MediaProbeStreamSchema = z.strictObject({
  index: z.number().int().nonnegative().max(65_535),
  kind: z.enum(['video', 'audio', 'subtitle', 'data', 'attachment', 'unknown']),
  codecName: z.string().min(1).max(128).optional(),
  codecLongName: z.string().min(1).max(256).optional(),
  durationMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  timeBase: RationalSchema.optional(),
  frameRate: RationalSchema.optional(),
  width: z.number().int().positive().max(1_000_000).optional(),
  height: z.number().int().positive().max(1_000_000).optional(),
  rotationDegrees: z.number().int().min(-359).max(359).optional(),
  sampleRate: z.number().int().positive().max(10_000_000).optional(),
  channelCount: z.number().int().positive().max(1024).optional(),
  channelLayout: z.string().min(1).max(128).optional(),
  language: z.string().min(1).max(64).optional(),
  disposition: MediaStreamDispositionSchema
})
export type MediaProbeStream = z.infer<typeof MediaProbeStreamSchema>

export const MediaProbeRequestSchema = z.strictObject({ handleId: MediaHandleIdSchema })
export type MediaProbeRequest = z.infer<typeof MediaProbeRequestSchema>

export const MediaProbeResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  handleId: MediaHandleIdSchema,
  container: z.strictObject({
    formatNames: z.array(z.string().min(1).max(128)).max(32),
    formatLongName: z.string().min(1).max(256).optional(),
    durationMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    startTimeMicros: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(),
    bitRate: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    tags: z.record(z.string().min(1).max(128), z.string().max(4096)).optional()
  }),
  streams: z.array(MediaProbeStreamSchema).max(256)
})
export type MediaProbeResult = z.infer<typeof MediaProbeResultSchema>

export const MediaCapabilityFeatureSchema = z.enum([
  'libx264-encoder',
  'libx265-encoder',
  'prores-ks-encoder',
  'ffv1-encoder',
  'aac-encoder',
  'flac-encoder',
  'pcm-s24-encoder',
  'pcm-s16-encoder',
  'drawtext-filter',
  'subtitles-filter',
  'eq-filter',
  'colorbalance-filter',
  'boxblur-filter',
  'unsharp-filter',
  'vignette-filter',
  'silencedetect-filter',
  'mp4-muxer',
  'mov-muxer',
  'matroska-muxer',
  's16le-muxer'
])
export type MediaCapabilityFeature = z.infer<typeof MediaCapabilityFeatureSchema>

export const MediaExecutableCapabilitySchema = z.strictObject({
  name: z.enum(['ffprobe', 'ffmpeg']),
  available: z.boolean(),
  version: z.string().min(1).max(512).optional(),
  features: z.array(MediaCapabilityFeatureSchema).max(32).default([])
})
export type MediaExecutableCapability = z.infer<typeof MediaExecutableCapabilitySchema>

export const MediaCapabilitiesSchema = z.strictObject({
  probedAt: z.string().datetime(),
  ffprobe: MediaExecutableCapabilitySchema,
  ffmpeg: MediaExecutableCapabilitySchema
})
export type MediaCapabilities = z.infer<typeof MediaCapabilitiesSchema>

const FfmpegBindingNameSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/)

/**
 * Optional runtime scheduling hints for bounded native media work. The Host is
 * authoritative: callers cannot select a process, path, queue, or worker. The
 * retry contract is deliberately small so a broker never repeats an unknown
 * side effect; only failures explicitly classified as transient by Kun qualify.
 */
export const MediaJobPrioritySchema = z.enum([
  'background',
  'user',
  'interactive',
  'export'
])
export type MediaJobPriority = z.infer<typeof MediaJobPrioritySchema>

export const MediaJobSchedulingSchema = z.strictObject({
  priority: MediaJobPrioritySchema.default('user'),
  maxAttempts: z.number().int().min(1).max(3).default(1),
  retryBaseDelayMs: z.number().int().min(25).max(5_000).default(250)
})
export type MediaJobScheduling = z.infer<typeof MediaJobSchedulingSchema>

export const MediaTextOutputMimeTypeSchema = z.enum([
  'application/x-subrip',
  'application/x-otio+json',
  'text/vtt'
])
export type MediaTextOutputMimeType = z.infer<typeof MediaTextOutputMimeTypeSchema>

export const MAX_MEDIA_SUBTITLE_TEXT_BYTES = 192 * 1024
export const MAX_MEDIA_OTIO_TEXT_BYTES = 2 * 1024 * 1024

export const MediaTextOutputSchema = z.strictObject({
  handleId: MediaHandleIdSchema,
  mimeType: MediaTextOutputMimeTypeSchema,
  content: z.string().min(1).max(MAX_MEDIA_OTIO_TEXT_BYTES)
}).superRefine((value, context) => {
  const byteLength = new TextEncoder().encode(value.content).byteLength
  if (value.mimeType === 'application/x-otio+json') {
    validateBoundedOtioJson(value.content, context)
  } else if (byteLength > MAX_MEDIA_SUBTITLE_TEXT_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['content'],
      message: 'Subtitle text output exceeds 192 KiB'
    })
  }
})
export type MediaTextOutput = z.infer<typeof MediaTextOutputSchema>

const MediaTextOutputsSchema = z
  .record(FfmpegBindingNameSchema, MediaTextOutputSchema)
  .superRefine((outputs, context) => {
    if (Object.keys(outputs).length > 8) {
      context.addIssue({
        code: 'custom',
        message: 'A media job may contain at most 8 bounded text outputs'
      })
    }
    const encoder = new TextEncoder()
    const totalBytes = Object.values(outputs).reduce(
      (total, output) => total + encoder.encode(output.content).byteLength,
      0
    )
    if (totalBytes > MAX_MEDIA_OTIO_TEXT_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Media text outputs may contain at most 2 MiB of UTF-8 content in total'
      })
    }
  })

function validateBoundedOtioJson(
  content: string,
  context: z.RefinementCtx
): void {
  if (new TextEncoder().encode(content).byteLength > MAX_MEDIA_OTIO_TEXT_BYTES) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'OTIO JSON exceeds 2 MiB' })
    return
  }
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch {
    context.addIssue({ code: 'custom', path: ['content'], message: 'OTIO output must be valid JSON' })
    return
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'OTIO output root must be an object' })
    return
  }
  const schema = (root as Record<string, unknown>).OTIO_SCHEMA
  if (schema !== 'SerializableCollection.1' && schema !== 'Timeline.1') {
    context.addIssue({
      code: 'custom',
      path: ['content'],
      message: 'OTIO output requires a supported SerializableCollection.1 or Timeline.1 root'
    })
    return
  }
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > 100_000 || current.depth > 64) {
      context.addIssue({ code: 'custom', path: ['content'], message: 'OTIO JSON structure exceeds its bound' })
      return
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 })
      continue
    }
    if (!current.value || typeof current.value !== 'object') continue
    for (const [key, child] of Object.entries(current.value as Record<string, unknown>)) {
      if (key === 'target_url' && (
        typeof child !== 'string' ||
        !/^kun-media:\/\/[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(child)
      )) {
        context.addIssue({
          code: 'custom',
          path: ['content'],
          message: 'OTIO media references must use bounded opaque kun-media URLs'
        })
        return
      }
      pending.push({ value: child, depth: current.depth + 1 })
    }
  }
}

export const MediaStartFfmpegJobRequestSchema = z.strictObject({
  arguments: z.array(z.string().min(1).max(8192)).max(1024),
  inputs: z.record(FfmpegBindingNameSchema, MediaHandleIdSchema),
  outputs: z.record(FfmpegBindingNameSchema, MediaHandleIdSchema),
  textOutputs: MediaTextOutputsSchema.optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
  metadata: JsonObjectSchema.optional(),
  scheduling: MediaJobSchedulingSchema.optional()
}).superRefine((request, context) => {
  const inputCount = Object.keys(request.inputs).length
  const outputCount = Object.keys(request.outputs).length
  const textOutputCount = Object.keys(request.textOutputs ?? {}).length
  const textOnly = outputCount === 0

  if (textOnly) {
    if (textOutputCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['textOutputs'],
        message: 'A text-only media job requires at least one text output'
      })
    }
    if (inputCount !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['inputs'],
        message: 'A text-only media job cannot declare FFmpeg inputs'
      })
    }
    if (request.arguments.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['arguments'],
        message: 'A text-only media job cannot declare FFmpeg arguments'
      })
    }
    return
  }

  if (inputCount === 0) {
    context.addIssue({
      code: 'custom',
      path: ['inputs'],
      message: 'An FFmpeg media job requires at least one input'
    })
  }
  if (request.arguments.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['arguments'],
      message: 'An FFmpeg media job requires at least one argument'
    })
  }
})
export type MediaStartFfmpegJobRequest = z.infer<typeof MediaStartFfmpegJobRequestSchema>

export const MediaStartFfmpegJobResultSchema = z.strictObject({ job: JobReferenceSchema })
export type MediaStartFfmpegJobResult = z.infer<typeof MediaStartFfmpegJobResultSchema>

/**
 * Host-owned local audio analysis. Extensions select a bounded algorithm and
 * opaque media handles; they never provide commands, filters, paths, or native
 * executable arguments.
 */
export const MediaAudioAnalysisKindSchema = z.enum([
  'silence',
  'beat-grid',
  'sync-features'
])
export type MediaAudioAnalysisKind = z.infer<typeof MediaAudioAnalysisKindSchema>

export const MediaAudioAnalysisUnavailableCodeSchema = z.enum([
  'AUDIO_ANALYSIS_EXECUTABLE_UNAVAILABLE',
  'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE'
])
export type MediaAudioAnalysisUnavailableCode = z.infer<
  typeof MediaAudioAnalysisUnavailableCodeSchema
>

export const MediaAudioAnalysisCapabilitySchema = z.discriminatedUnion('available', [
  z.strictObject({
    analysis: MediaAudioAnalysisKindSchema,
    available: z.literal(true),
    algorithm: z.string().min(1).max(128),
    algorithmVersion: z.string().min(1).max(64),
    local: z.literal(true),
    networkUsed: z.literal(false)
  }),
  z.strictObject({
    analysis: MediaAudioAnalysisKindSchema,
    available: z.literal(false),
    code: MediaAudioAnalysisUnavailableCodeSchema,
    remediation: z.string().min(1).max(1024),
    retryable: z.boolean(),
    local: z.literal(true),
    networkUsed: z.literal(false)
  })
])
export type MediaAudioAnalysisCapability = z.infer<typeof MediaAudioAnalysisCapabilitySchema>

export const MediaAudioAnalysisCapabilitiesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  probedAt: z.string().datetime(),
  analyses: z.array(MediaAudioAnalysisCapabilitySchema).length(3)
}).superRefine((value, context) => {
  const kinds = value.analyses.map(({ analysis }) => analysis)
  if (new Set(kinds).size !== kinds.length) {
    context.addIssue({
      code: 'custom',
      path: ['analyses'],
      message: 'Audio analysis capabilities must contain unique analysis kinds'
    })
  }
  for (const required of MediaAudioAnalysisKindSchema.options) {
    if (!kinds.includes(required)) {
      context.addIssue({
        code: 'custom',
        path: ['analyses'],
        message: `Audio analysis capability is missing ${required}`
      })
    }
  }
})
export type MediaAudioAnalysisCapabilities = z.infer<
  typeof MediaAudioAnalysisCapabilitiesSchema
>

const AudioAnalysisIdempotencyKeySchema = z.string().min(1).max(256).optional()

export const MediaStartSilenceAnalysisJobRequestSchema = z.strictObject({
  analysis: z.literal('silence'),
  inputHandleId: MediaHandleIdSchema,
  noiseThresholdDb: z.number().finite().min(-100).max(-1).default(-35),
  minimumSilenceMicros: z.number().int().min(20_000).max(60_000_000).default(300_000),
  maxIntervals: z.number().int().min(1).max(2_048).default(1_000),
  idempotencyKey: AudioAnalysisIdempotencyKeySchema,
  metadata: JsonObjectSchema.optional()
})
export type MediaStartSilenceAnalysisJobRequest = z.input<
  typeof MediaStartSilenceAnalysisJobRequestSchema
>

export const MediaStartBeatAnalysisJobRequestSchema = z.strictObject({
  analysis: z.literal('beat-grid'),
  inputHandleId: MediaHandleIdSchema,
  maxMarkers: z.number().int().min(1).max(4_096).default(2_000),
  idempotencyKey: AudioAnalysisIdempotencyKeySchema,
  metadata: JsonObjectSchema.optional()
})
export type MediaStartBeatAnalysisJobRequest = z.input<
  typeof MediaStartBeatAnalysisJobRequestSchema
>

export const MediaStartSyncFeaturesAnalysisJobRequestSchema = z.strictObject({
  analysis: z.literal('sync-features'),
  referenceHandleId: MediaHandleIdSchema,
  targetHandleId: MediaHandleIdSchema,
  seed: z.number().int().min(0).max(0x7fffffff),
  samplePeriodMicros: z.number().int().min(20_000).max(1_000_000).default(100_000),
  maximumDurationMicros: z
    .number()
    .int()
    .min(200_000)
    .max(600_000_000)
    .default(600_000_000),
  maxFeaturePoints: z.number().int().min(8).max(4_096).default(4_096),
  idempotencyKey: AudioAnalysisIdempotencyKeySchema,
  metadata: JsonObjectSchema.optional()
}).refine((value) => value.referenceHandleId !== value.targetHandleId, {
  path: ['targetHandleId'],
  message: 'Audio synchronization requires two different media handles'
})
export type MediaStartSyncFeaturesAnalysisJobRequest = z.input<
  typeof MediaStartSyncFeaturesAnalysisJobRequestSchema
>

export const MediaStartAudioAnalysisJobRequestSchema = z.discriminatedUnion('analysis', [
  MediaStartSilenceAnalysisJobRequestSchema,
  MediaStartBeatAnalysisJobRequestSchema,
  MediaStartSyncFeaturesAnalysisJobRequestSchema
])
export type MediaStartAudioAnalysisJobRequest = z.input<
  typeof MediaStartAudioAnalysisJobRequestSchema
>
export type ParsedMediaStartAudioAnalysisJobRequest = z.infer<
  typeof MediaStartAudioAnalysisJobRequestSchema
>

export const MediaStartAudioAnalysisJobResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('started'), job: JobReferenceSchema }),
  z.strictObject({
    outcome: z.literal('unavailable'),
    analysis: MediaAudioAnalysisKindSchema,
    code: MediaAudioAnalysisUnavailableCodeSchema,
    remediation: z.string().min(1).max(1024),
    retryable: z.boolean(),
    local: z.literal(true),
    networkUsed: z.literal(false)
  })
])
export type MediaStartAudioAnalysisJobResult = z.infer<
  typeof MediaStartAudioAnalysisJobResultSchema
>

const AudioAnalysisSourceSchema = z.strictObject({
  handleId: MediaHandleIdSchema,
  fingerprint: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  fingerprintAlgorithm: z.literal('sha256-file-identity-v1')
})

const AudioAnalysisProvenanceSchema = z.strictObject({
  algorithm: z.string().min(1).max(128),
  algorithmVersion: z.string().min(1).max(64),
  local: z.literal(true),
  networkUsed: z.literal(false)
})

export const MediaSilenceAnalysisResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  analysis: z.literal('silence'),
  source: AudioAnalysisSourceSchema,
  provenance: AudioAnalysisProvenanceSchema,
  parameters: z.strictObject({
    noiseThresholdDb: z.number().finite().min(-100).max(-1),
    minimumSilenceMicros: z.number().int().min(20_000).max(60_000_000)
  }),
  intervals: z.array(z.strictObject({
    startMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    endMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    confidence: z.literal(1),
    confidenceSemantics: z.literal('threshold-classification')
  }).refine((interval) => interval.endMicros > interval.startMicros, {
    message: 'Silence interval end must be after start'
  })).max(2_048),
  analyzedDurationMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  truncated: z.boolean()
})
export type MediaSilenceAnalysisResult = z.infer<typeof MediaSilenceAnalysisResultSchema>

export const MediaBeatAnalysisResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  analysis: z.literal('beat-grid'),
  source: AudioAnalysisSourceSchema,
  provenance: AudioAnalysisProvenanceSchema,
  tempoBpm: z.number().finite().min(20).max(400).optional(),
  markers: z.array(z.strictObject({
    timeMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum(['beat', 'downbeat']),
    confidence: z.number().finite().min(0).max(1),
    strength: z.number().finite().min(0).max(1)
  })).max(4_096),
  analyzedDurationMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  truncated: z.boolean()
})
export type MediaBeatAnalysisResult = z.infer<typeof MediaBeatAnalysisResultSchema>

const SyncFeatureSeriesSchema = z.array(z.number().finite().min(-1).max(1)).min(8).max(4_096)

export const MediaSyncFeaturesAnalysisResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  analysis: z.literal('sync-features'),
  reference: AudioAnalysisSourceSchema,
  target: AudioAnalysisSourceSchema,
  provenance: AudioAnalysisProvenanceSchema,
  seed: z.number().int().min(0).max(0x7fffffff),
  samplePeriodMicros: z.number().int().min(20_000).max(1_000_000),
  referenceFeatures: SyncFeatureSeriesSchema,
  targetFeatures: SyncFeatureSeriesSchema,
  referenceAnalyzedDurationMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  targetAnalyzedDurationMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  truncated: z.boolean()
})
export type MediaSyncFeaturesAnalysisResult = z.infer<
  typeof MediaSyncFeaturesAnalysisResultSchema
>

export const MediaAudioAnalysisResultSchema = z.discriminatedUnion('analysis', [
  MediaSilenceAnalysisResultSchema,
  MediaBeatAnalysisResultSchema,
  MediaSyncFeaturesAnalysisResultSchema
])
export type MediaAudioAnalysisResult = z.infer<typeof MediaAudioAnalysisResultSchema>

/**
 * Host-owned local visual analysis. The public surface exposes a verified
 * model/algorithm identity plus bounded vectors; frame bytes, executable
 * arguments, model locations, paths, and reusable media URLs never cross the
 * broker boundary.
 */
export const MediaVisualModelFileSchema = z.strictObject({
  name: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  sha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
export type MediaVisualModelFile = z.infer<typeof MediaVisualModelFileSchema>

export const MediaVisualModelDescriptorSchema = z.strictObject({
  adapterId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  adapterVersion: z.string().min(1).max(64).regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/),
  modelId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  modelVersion: z.string().min(1).max(64).regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/),
  packageId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  manifestSha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  files: z.array(MediaVisualModelFileSchema).min(1).max(128),
  embeddingDimensions: z.number().int().min(1).max(4_096),
  execution: z.literal('local'),
  querySemantics: z.literal('bounded-visual-features-v1')
}).superRefine((value, context) => {
  const names = value.files.map(({ name }) => name)
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'Visual model file names must be unique' })
  }
})
export type MediaVisualModelDescriptor = z.infer<typeof MediaVisualModelDescriptorSchema>

export const MediaVisualModelInstallReceiptSchema = z.strictObject({
  broker: z.literal('kun-model-broker'),
  packageSource: z.enum(['bundled', 'downloaded']),
  packageId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(128),
  modelVersion: z.string().min(1).max(64),
  manifestSha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  files: z.array(MediaVisualModelFileSchema).min(1).max(128),
  /** True only when bytes actually came from a download and were verified. */
  downloadVerified: z.boolean(),
  /** True when the selected bundled/downloaded package source was verified. */
  sourceVerified: z.literal(true),
  installVerified: z.literal(true),
  signatureVerified: z.literal(true),
  installedAt: z.string().datetime()
}).superRefine((value, context) => {
  if (value.packageSource === 'downloaded' && !value.downloadVerified) {
    context.addIssue({
      code: 'custom',
      path: ['downloadVerified'],
      message: 'Downloaded visual model packages must have a verified download'
    })
  }
  if (value.packageSource === 'bundled' && value.downloadVerified) {
    context.addIssue({
      code: 'custom',
      path: ['downloadVerified'],
      message: 'Bundled visual model packages must not claim a download occurred'
    })
  }
})
export type MediaVisualModelInstallReceipt = z.infer<typeof MediaVisualModelInstallReceiptSchema>

export const MediaVisualModelStatusSchema = z.strictObject({
  schemaVersion: z.literal(1),
  state: z.enum(['missing', 'installed', 'failed']),
  descriptor: MediaVisualModelDescriptorSchema,
  receipt: MediaVisualModelInstallReceiptSchema.optional(),
  installSupported: z.boolean(),
  checkedAt: z.string().datetime(),
  remediation: z.string().min(1).max(1_024),
  local: z.literal(true),
  networkUsedForInference: z.literal(false),
  rawPathsExposed: z.literal(false),
  urlsAccepted: z.literal(false)
}).superRefine((value, context) => {
  if (value.state === 'installed' && !value.receipt) {
    context.addIssue({ code: 'custom', path: ['receipt'], message: 'Installed visual model status requires a receipt' })
  }
  if (value.receipt && (
    value.receipt.packageId !== value.descriptor.packageId ||
    value.receipt.modelId !== value.descriptor.modelId ||
    value.receipt.modelVersion !== value.descriptor.modelVersion ||
    value.receipt.manifestSha256 !== value.descriptor.manifestSha256
  )) {
    context.addIssue({ code: 'custom', path: ['receipt'], message: 'Visual model receipt identity must match its descriptor' })
  }
})
export type MediaVisualModelStatus = z.infer<typeof MediaVisualModelStatusSchema>

export const MediaInstallVisualModelRequestSchema = z.strictObject({})
export type MediaInstallVisualModelRequest = z.infer<typeof MediaInstallVisualModelRequestSchema>

export const MediaVisualAdapterBindingSchema = z.strictObject({
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
  modelId: z.string().min(1).max(128),
  modelVersion: z.string().min(1).max(64),
  packageId: z.string().min(1).max(128),
  manifestSha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  embeddingDimensions: z.number().int().min(1).max(4_096),
  execution: z.literal('local')
})
export type MediaVisualAdapterBinding = z.infer<typeof MediaVisualAdapterBindingSchema>

export const MediaVisualFrameSampleSchema = z.strictObject({
  sampleId: z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  startMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  representativeMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).superRefine((value, context) => {
  if (value.endMicros <= value.startMicros) {
    context.addIssue({ code: 'custom', path: ['endMicros'], message: 'Visual sample end must be after start' })
  }
  if (value.representativeMicros < value.startMicros || value.representativeMicros >= value.endMicros) {
    context.addIssue({
      code: 'custom',
      path: ['representativeMicros'],
      message: 'Visual sample representative time must be inside its half-open range'
    })
  }
})
export type MediaVisualFrameSample = z.infer<typeof MediaVisualFrameSampleSchema>

export const MediaVisualUnavailableCodeSchema = z.enum([
  'VISUAL_EXECUTABLE_UNAVAILABLE',
  'VISUAL_MODEL_MISSING',
  'VISUAL_MODEL_UNVERIFIED',
  'VISUAL_MODEL_MISMATCH',
  'VISUAL_MEDIA_UNSUPPORTED',
  'VISUAL_QUERY_UNSUPPORTED'
])
export type MediaVisualUnavailableCode = z.infer<typeof MediaVisualUnavailableCodeSchema>

const MediaVisualUnavailableResultSchema = z.strictObject({
  outcome: z.literal('unavailable'),
  code: MediaVisualUnavailableCodeSchema,
  remediation: z.string().min(1).max(1_024),
  retryable: z.boolean(),
  local: z.literal(true),
  networkUsed: z.literal(false)
})

export const MediaAnalyzeVisualFramesRequestSchema = z.strictObject({
  inputHandleId: MediaHandleIdSchema,
  samples: z.array(MediaVisualFrameSampleSchema).min(1).max(16),
  adapter: MediaVisualAdapterBindingSchema
}).superRefine((value, context) => {
  const ids = value.samples.map(({ sampleId }) => sampleId)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['samples'], message: 'Visual sample IDs must be unique' })
  }
})
export type MediaAnalyzeVisualFramesRequest = z.infer<typeof MediaAnalyzeVisualFramesRequestSchema>

const MediaVisualSourceSchema = z.strictObject({
  handleId: MediaHandleIdSchema,
  fingerprint: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  fingerprintAlgorithm: z.literal('sha256-file-identity-v1')
})

export const MediaAnalyzeVisualFramesResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('ready'),
    source: MediaVisualSourceSchema,
    adapter: MediaVisualAdapterBindingSchema,
    embeddings: z.array(z.strictObject({
      sampleId: z.string().min(1).max(512),
      vector: z.array(z.number().finite().min(-1).max(1)).min(1).max(4_096)
    })).min(1).max(16),
    provenance: z.strictObject({
      algorithm: z.literal('kun.rgb-edge-features'),
      algorithmVersion: z.literal('1.0.0'),
      decodedFrameWidth: z.literal(32),
      decodedFrameHeight: z.literal(32),
      local: z.literal(true),
      networkUsed: z.literal(false)
    })
  }).superRefine((value, context) => {
    const ids = value.embeddings.map(({ sampleId }) => sampleId)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['embeddings'], message: 'Visual embedding sample IDs must be unique' })
    }
    for (const [index, embedding] of value.embeddings.entries()) {
      if (embedding.vector.length !== value.adapter.embeddingDimensions) {
        context.addIssue({
          code: 'custom',
          path: ['embeddings', index, 'vector'],
          message: 'Visual embedding dimensions must match the verified adapter'
        })
      }
    }
  }),
  MediaVisualUnavailableResultSchema
])
export type MediaAnalyzeVisualFramesResult = z.infer<typeof MediaAnalyzeVisualFramesResultSchema>

export const MediaEmbedVisualQueryRequestSchema = z.strictObject({
  query: z.string().min(1).max(256).refine((value) => !containsAsciiControlCharacters(value), {
    message: 'Visual query must contain printable text'
  }),
  adapter: MediaVisualAdapterBindingSchema
})
export type MediaEmbedVisualQueryRequest = z.infer<typeof MediaEmbedVisualQueryRequestSchema>

export const MediaEmbedVisualQueryResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('ready'),
    adapter: MediaVisualAdapterBindingSchema,
    vector: z.array(z.number().finite().min(-1).max(1)).min(1).max(4_096),
    matchedConcepts: z.array(z.string().min(1).max(64)).min(1).max(32),
    scoreSemantics: z.literal('uncalibrated-cosine'),
    local: z.literal(true),
    networkUsed: z.literal(false)
  }).superRefine((value, context) => {
    if (value.vector.length !== value.adapter.embeddingDimensions) {
      context.addIssue({
        code: 'custom',
        path: ['vector'],
        message: 'Visual query dimensions must match the verified adapter'
      })
    }
  }),
  MediaVisualUnavailableResultSchema
])
export type MediaEmbedVisualQueryResult = z.infer<typeof MediaEmbedVisualQueryResultSchema>

export const MAX_MEDIA_ARCHIVE_ENTRIES = 512
export const MAX_MEDIA_ARCHIVE_INLINE_BYTES = 2 * 1024 * 1024

export const MediaArchivePathSchema = z.string().min(1).max(512).superRefine((value, context) => {
  if (
    value.startsWith('/') || value.endsWith('/') || value.includes('\\') ||
    value.includes('\0') || value.split('/').some((segment) =>
      !segment || segment === '.' || segment === '..' || segment.length > 160
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Archive entry paths must be normalized relative POSIX file paths'
    })
  }
})
export type MediaArchivePath = z.infer<typeof MediaArchivePathSchema>

export const MediaArchiveInputEntrySchema = z.strictObject({
  kind: z.literal('media'),
  inputHandleId: MediaHandleIdSchema,
  archivePath: MediaArchivePathSchema
})
export type MediaArchiveInputEntry = z.infer<typeof MediaArchiveInputEntrySchema>

export const MediaArchiveInlineEntrySchema = z.strictObject({
  kind: z.literal('inline-text'),
  archivePath: MediaArchivePathSchema,
  content: z.string().max(MAX_MEDIA_ARCHIVE_INLINE_BYTES),
  mimeType: z.enum(['application/json', 'application/x-otio+json', 'text/markdown', 'text/plain'])
})
export type MediaArchiveInlineEntry = z.infer<typeof MediaArchiveInlineEntrySchema>

export const MediaStartArchiveJobRequestSchema = z.strictObject({
  format: z.literal('zip'),
  outputHandleId: MediaHandleIdSchema,
  entries: z.array(z.discriminatedUnion('kind', [
    MediaArchiveInputEntrySchema,
    MediaArchiveInlineEntrySchema
  ])).min(1).max(MAX_MEDIA_ARCHIVE_ENTRIES),
  idempotencyKey: z.string().min(1).max(256).optional()
}).superRefine((value, context) => {
  const paths = value.entries.map(({ archivePath }) => archivePath)
  if (new Set(paths).size !== paths.length) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'Archive entry paths must be unique'
    })
  }
  const inlineBytes = value.entries.reduce((total, entry) =>
    total + (entry.kind === 'inline-text' ? new TextEncoder().encode(entry.content).byteLength : 0), 0)
  if (inlineBytes > MAX_MEDIA_ARCHIVE_INLINE_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: `Inline archive content exceeds ${MAX_MEDIA_ARCHIVE_INLINE_BYTES} UTF-8 bytes`
    })
  }
})
export type MediaStartArchiveJobRequest = z.input<typeof MediaStartArchiveJobRequestSchema>
export type ParsedMediaStartArchiveJobRequest = z.infer<typeof MediaStartArchiveJobRequestSchema>

export const MediaStartArchiveJobResultSchema = z.strictObject({
  outcome: z.literal('started'),
  job: JobReferenceSchema
})
export type MediaStartArchiveJobResult = z.infer<typeof MediaStartArchiveJobResultSchema>

export const MediaArchiveJobResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  format: z.literal('zip'),
  entryCount: z.number().int().min(1).max(MAX_MEDIA_ARCHIVE_ENTRIES),
  inputBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  archiveBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  generatedMedia: MediaMetadataSchema
})
export type MediaArchiveJobResult = z.infer<typeof MediaArchiveJobResultSchema>

export const MEDIA_ERROR_CODES = [
  'MEDIA_CANCELLED',
  'MEDIA_INTERACTION_REQUIRED',
  'MEDIA_PERMISSION_DENIED',
  'MEDIA_SCOPE_DENIED',
  'MEDIA_NOT_FOUND',
  'MEDIA_HANDLE_REVOKED',
  'MEDIA_EXECUTABLE_UNAVAILABLE',
  'MEDIA_INVALID_ARGUMENT',
  'MEDIA_INVALID_OUTPUT',
  'MEDIA_LIMIT_EXCEEDED',
  'MEDIA_TIMEOUT'
] as const

export const MediaErrorCodeSchema = z.enum(MEDIA_ERROR_CODES)
export type MediaErrorCode = z.infer<typeof MediaErrorCodeSchema>

export const MediaErrorSchema = z.strictObject({
  code: MediaErrorCodeSchema,
  message: z.string().min(1).max(4096),
  operation: z.string().min(1).max(128),
  retryable: z.boolean(),
  limitCategory: z.string().min(1).max(128).optional(),
  details: JsonObjectSchema.optional()
})
export type MediaError = z.infer<typeof MediaErrorSchema>
