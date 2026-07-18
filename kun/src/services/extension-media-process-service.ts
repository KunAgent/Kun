import { createHash } from 'node:crypto'
import { access, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { constants } from 'node:fs'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { terminateSpawnTree } from '../adapters/tool/builtin-tool-utils.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionMediaHandleService,
  type ResolvedMediaHandle
} from './extension-media-handle-service.js'

export type MediaExecutableName = 'ffprobe' | 'ffmpeg'

/**
 * Keep native media readers on local, non-delegating inputs. The format list
 * intentionally excludes playlist/manifest and virtual-input demuxers such as
 * concat, HLS, DASH, lavfi, and capture devices. It is injected by core code,
 * never accepted from an extension argument list.
 */
export const EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST = 'file'
export const EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST = [
  'aac',
  'ac3',
  'aiff',
  'alaw',
  'amr',
  'ape',
  'apng',
  'asf',
  'au',
  'av1',
  'avi',
  'avif',
  'caf',
  'dirac',
  'dts',
  'dv',
  'eac3',
  'flac',
  'flv',
  'gif',
  'h261',
  'h263',
  'h264',
  'hevc',
  'image2',
  'jpeg_pipe',
  'matroska',
  'mjpeg',
  'mjpeg_2000',
  'mov',
  'mp4',
  'm4a',
  '3gp',
  '3g2',
  'mj2',
  'mp3',
  'mpeg',
  'mpegvideo',
  'mpegts',
  'ogg',
  'opus',
  'png_pipe',
  'rawvideo',
  's16be',
  's16le',
  's24be',
  's24le',
  's32be',
  's32le',
  's8',
  'srt',
  'u16be',
  'u16le',
  'u24be',
  'u24le',
  'u32be',
  'u32le',
  'u8',
  'wav',
  'webm',
  'webvtt',
  'webp_pipe',
  'yuv4mpegpipe'
].join(',')

export type MediaCapability = {
  name: MediaExecutableName
  available: boolean
  source?: 'configured' | 'path'
  version?: string
  features?: Array<
    | 'libx264-encoder'
    | 'libx265-encoder'
    | 'prores-ks-encoder'
    | 'ffv1-encoder'
    | 'aac-encoder'
    | 'flac-encoder'
    | 'pcm-s24-encoder'
    | 'pcm-s16-encoder'
    | 'drawtext-filter'
    | 'subtitles-filter'
    | 'eq-filter'
    | 'colorbalance-filter'
    | 'boxblur-filter'
    | 'unsharp-filter'
    | 'vignette-filter'
    | 'silencedetect-filter'
    | 'mp4-muxer'
    | 'mov-muxer'
    | 'matroska-muxer'
    | 's16le-muxer'
  >
}

export type MediaCapabilities = {
  probedAt: string
  ffprobe: MediaCapability
  ffmpeg: MediaCapability
}

export type MediaProbeMetadata = {
  schemaVersion: 1
  handleId: string
  container: {
    formatNames: string[]
    formatLongName?: string
    durationMicros?: number
    startTimeMicros?: number
    bitRate?: number
  }
  streams: Array<{
    index: number
    kind: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | 'unknown'
    codecName?: string
    codecLongName?: string
    timeBase?: { numerator: number; denominator: number }
    frameRate?: { numerator: number; denominator: number }
    durationMicros?: number
    width?: number
    height?: number
    rotationDegrees?: number
    channelCount?: number
    sampleRate?: number
    channelLayout?: string
    language?: string
    disposition: { default: boolean; forced: boolean; attachedPicture: boolean }
  }>
}

export type ExtensionAudioAnalysisCapabilities = {
  probedAt: string
  executablesAvailable: boolean
  silence: boolean
  syncFeatures: boolean
  beatGrid: boolean
}

export type ExtensionAudioSourceEvidence = {
  handleId: string
  fingerprint: string
  fingerprintAlgorithm: 'sha256-file-identity-v1'
}

export type ExtensionSilenceAnalysis = {
  source: ExtensionAudioSourceEvidence
  intervals: Array<{
    startMicros: number
    endMicros: number
    confidence: 1
    confidenceSemantics: 'threshold-classification'
  }>
  analyzedDurationMicros: number
  truncated: boolean
}

export type ExtensionSyncFeatureSeries = {
  source: ExtensionAudioSourceEvidence
  features: number[]
  analyzedDurationMicros: number
  truncated: boolean
}

export type ExtensionBeatGridAnalysis = {
  source: ExtensionAudioSourceEvidence
  tempoBpm?: number
  markers: Array<{
    timeMicros: number
    kind: 'beat' | 'downbeat'
    confidence: number
    strength: number
  }>
  analyzedDurationMicros: number
  truncated: boolean
}

export type ExtensionVisualFrameSample = {
  sampleId: string
  startMicros: number
  endMicros: number
  representativeMicros: number
}

export type ExtensionVisualFrameAnalysis = {
  source: ExtensionAudioSourceEvidence
  embeddings: Array<{ sampleId: string; vector: number[] }>
  decodedFrameWidth: 32
  decodedFrameHeight: 32
}

export class ExtensionMediaProcessError extends Error {
  constructor(
    readonly code:
      | 'permission_denied'
      | 'executable_unavailable'
      | 'process_failed'
      | 'process_timeout'
      | 'process_cancelled'
      | 'output_limit'
      | 'invalid_probe_output'
      | 'invalid_analysis_output',
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}

type RunResult = { stdout: Buffer; stderr: Buffer; exitCode: number }

const SYNC_FEATURE_SAMPLE_RATE = 1_000
const BEAT_PCM_SAMPLE_RATE = 200
const BEAT_WINDOW_MICROS = 50_000
const BEAT_MAX_ANALYSIS_MICROS = 60 * 60 * 1_000_000
const BEAT_MIN_BPM = 40
const BEAT_MAX_BPM = 240
export const VISUAL_FEATURE_DIMENSIONS = 24
const VISUAL_FRAME_WIDTH = 32
const VISUAL_FRAME_HEIGHT = 32
const VISUAL_FRAME_BYTES = VISUAL_FRAME_WIDTH * VISUAL_FRAME_HEIGHT * 3

type MediaProcessOptions = {
  handleService: ExtensionMediaHandleService
  ffprobePath?: string
  ffmpegPath?: string
  pathEnv?: string
  discoveryDirectories?: string[]
  now?: () => Date
  probeTimeoutMs?: number
  discoveryTimeoutMs?: number
  maxProbeOutputBytes?: number
  maxDiagnosticBytes?: number
  ffmpegTimeoutMs?: number
  maxFfmpegProgressBytes?: number
  maxFfmpegLogBytes?: number
  // Test fixtures are JavaScript files, which Windows cannot execute directly
  // with the production shell-free process boundary.
  processRunner?: typeof runBoundedProcess
}

/**
 * Host-owned native media process boundary. It never accepts an extension path
 * and exposes only normalized, bounded metadata.
 */
export class ExtensionMediaProcessService {
  private readonly now: () => Date
  private readonly probeTimeoutMs: number
  private readonly discoveryTimeoutMs: number
  private readonly maxProbeOutputBytes: number
  private readonly maxDiagnosticBytes: number
  private readonly ffmpegTimeoutMs: number
  private readonly maxFfmpegProgressBytes: number
  private readonly maxFfmpegLogBytes: number
  private readonly configuredPaths: Partial<Record<MediaExecutableName, string>>
  private readonly pathEnv: string
  private readonly discoveryDirectories: string[]
  private readonly processRunner: typeof runBoundedProcess

  constructor(private readonly options: MediaProcessOptions) {
    this.now = options.now ?? (() => new Date())
    this.probeTimeoutMs = boundedInteger(options.probeTimeoutMs, 30_000, 250, 300_000)
    this.discoveryTimeoutMs = boundedInteger(options.discoveryTimeoutMs, 5_000, 100, 30_000)
    this.maxProbeOutputBytes = boundedInteger(options.maxProbeOutputBytes, 2 * 1024 * 1024, 1024, 8 * 1024 * 1024)
    this.maxDiagnosticBytes = boundedInteger(options.maxDiagnosticBytes, 64 * 1024, 1024, 1024 * 1024)
    this.ffmpegTimeoutMs = boundedInteger(options.ffmpegTimeoutMs, 6 * 60 * 60 * 1000, 1_000, 24 * 60 * 60 * 1000)
    this.maxFfmpegProgressBytes = boundedInteger(options.maxFfmpegProgressBytes, 2 * 1024 * 1024, 1024, 16 * 1024 * 1024)
    this.maxFfmpegLogBytes = boundedInteger(options.maxFfmpegLogBytes, 4 * 1024 * 1024, 1024, 32 * 1024 * 1024)
    this.configuredPaths = {
      ...(options.ffprobePath ? { ffprobe: options.ffprobePath } : {}),
      ...(options.ffmpegPath ? { ffmpeg: options.ffmpegPath } : {})
    }
    this.pathEnv = options.pathEnv ?? process.env.PATH ?? ''
    this.discoveryDirectories = options.discoveryDirectories ?? defaultMediaDiscoveryDirectories()
    this.processRunner = options.processRunner ?? runBoundedProcess
  }

  async capabilities(principal: ExtensionPrincipal): Promise<MediaCapabilities> {
    requireProcessPermission(principal)
    const [ffprobe, ffmpeg] = await Promise.all([
      this.inspectExecutable('ffprobe'),
      this.inspectExecutable('ffmpeg')
    ])
    return { probedAt: this.now().toISOString(), ffprobe, ffmpeg }
  }

  async audioAnalysisCapabilities(
    principal: ExtensionPrincipal
  ): Promise<ExtensionAudioAnalysisCapabilities> {
    requireProcessPermission(principal)
    const [ffprobe, ffmpeg] = await Promise.all([
      this.inspectExecutable('ffprobe'),
      this.inspectExecutable('ffmpeg')
    ])
    const executablePairAvailable = ffprobe.available && ffmpeg.available
    const features = new Set(ffmpeg.features ?? [])
    return {
      probedAt: this.now().toISOString(),
      executablesAvailable: executablePairAvailable,
      silence: executablePairAvailable && features.has('silencedetect-filter'),
      syncFeatures: executablePairAvailable &&
        features.has('pcm-s16-encoder') && features.has('s16le-muxer'),
      // FFmpeg is only the confined PCM decoder. Beat/downbeat evidence is
      // produced by Kun's deterministic bounded onset/autocorrelation
      // analyzer below; no optional plugin, model download, or network is used.
      beatGrid: executablePairAvailable &&
        features.has('pcm-s16-encoder') && features.has('s16le-muxer')
    }
  }

  async probe(
    principal: ExtensionPrincipal,
    handleId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<MediaProbeMetadata> {
    // Check media.process before handle resolution or executable discovery so
    // unauthorized callers cannot use the API as a capability oracle.
    requireProcessPermission(principal)
    const input = await this.options.handleService.resolve(principal, handleId, 'read')
    if (input.absolutePath.includes('%')) {
      throw new ExtensionMediaProcessError(
        'invalid_probe_output',
        'Media input name uses unsupported pattern syntax'
      )
    }
    const executable = await this.requireExecutable('ffprobe')
    const result = await this.processRunner(executable.path, [
      '-v', 'error',
      '-hide_banner',
      '-protocol_whitelist', EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
      '-format_whitelist', EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      input.absolutePath
    ], {
      env: scrubbedEnvironment(this.pathEnv),
      timeoutMs: this.probeTimeoutMs,
      maxStdoutBytes: this.maxProbeOutputBytes,
      maxStderrBytes: this.maxDiagnosticBytes,
      signal: options.signal
    })
    if (result.exitCode !== 0) {
      throw new ExtensionMediaProcessError('process_failed', 'Media probe failed')
    }
    return normalizeProbeJson(result.stdout, input)
  }

  /**
   * Core-only fixed silence detector. The public request controls numeric
   * bounds only; executable arguments and the resolved path stay inside Kun.
   */
  async analyzeSilenceForCore(
    principal: ExtensionPrincipal,
    handleId: string,
    input: {
      noiseThresholdDb: number
      minimumSilenceMicros: number
      maxIntervals: number
      signal?: AbortSignal
    }
  ): Promise<ExtensionSilenceAnalysis> {
    requireProcessPermission(principal)
    const source = await this.options.handleService.resolve(principal, handleId, 'read')
    assertSafeAnalysisInput(source)
    const probe = await this.probe(principal, handleId, { signal: input.signal })
    const durationMicros = audioDurationMicros(probe)
    if (!probe.streams.some(({ kind }) => kind === 'audio') || durationMicros === undefined) {
      throw new ExtensionMediaProcessError(
        'invalid_analysis_output',
        'Local silence analysis requires an audio stream with a positive duration'
      )
    }
    const executable = await this.requireExecutable('ffmpeg')
    const result = await this.processRunner(executable.path, [
      '-v', 'info',
      '-hide_banner',
      '-nostdin',
      '-protocol_whitelist', EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
      '-format_whitelist', EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
      '-i', source.absolutePath,
      '-map', '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-af', `silencedetect=noise=${boundedDecimal(input.noiseThresholdDb)}dB:d=${microsSeconds(input.minimumSilenceMicros)}`,
      '-f', 'null',
      '-'
    ], {
      env: scrubbedEnvironment(this.pathEnv),
      timeoutMs: this.ffmpegTimeoutMs,
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: this.maxFfmpegLogBytes,
      signal: input.signal
    })
    if (result.exitCode !== 0) {
      throw new ExtensionMediaProcessError('process_failed', 'Local silence analysis failed')
    }
    const parsed = parseSilenceIntervals(
      result.stderr.toString('utf8'),
      durationMicros,
      input.minimumSilenceMicros,
      input.maxIntervals
    )
    return {
      source: sourceEvidence(source),
      intervals: parsed.intervals,
      analyzedDurationMicros: durationMicros,
      truncated: parsed.truncated
    }
  }

  /**
   * Extract a bounded, mean-centred mono energy envelope suitable as input to
   * a separately seeded correlation planner. This method does not decide a
   * sync offset and never moves media.
   */
  async extractSyncFeaturesForCore(
    principal: ExtensionPrincipal,
    handleId: string,
    input: {
      samplePeriodMicros: number
      maximumDurationMicros: number
      maxFeaturePoints: number
      signal?: AbortSignal
    }
  ): Promise<ExtensionSyncFeatureSeries> {
    requireProcessPermission(principal)
    const source = await this.options.handleService.resolve(principal, handleId, 'read')
    assertSafeAnalysisInput(source)
    const probe = await this.probe(principal, handleId, { signal: input.signal })
    const durationMicros = audioDurationMicros(probe)
    if (!probe.streams.some(({ kind }) => kind === 'audio') || durationMicros === undefined) {
      throw new ExtensionMediaProcessError(
        'invalid_analysis_output',
        'Local synchronization features require an audio stream with a positive duration'
      )
    }
    const boundedDurationMicros = Math.min(
      input.maximumDurationMicros,
      input.samplePeriodMicros * input.maxFeaturePoints
    )
    const executable = await this.requireExecutable('ffmpeg')
    const result = await this.processRunner(executable.path, [
      '-v', 'error',
      '-hide_banner',
      '-nostdin',
      '-protocol_whitelist', EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
      '-format_whitelist', EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
      '-i', source.absolutePath,
      '-map', '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-ac', '1',
      '-ar', String(SYNC_FEATURE_SAMPLE_RATE),
      '-t', microsSeconds(boundedDurationMicros),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ], {
      env: scrubbedEnvironment(this.pathEnv),
      timeoutMs: this.ffmpegTimeoutMs,
      maxStdoutBytes: syncPcmByteLimit(boundedDurationMicros),
      maxStderrBytes: this.maxDiagnosticBytes,
      signal: input.signal
    })
    if (result.exitCode !== 0) {
      throw new ExtensionMediaProcessError(
        'process_failed',
        'Local synchronization feature extraction failed'
      )
    }
    const extracted = pcmEnergyFeatures(
      result.stdout,
      input.samplePeriodMicros,
      input.maxFeaturePoints
    )
    if (extracted.features.length < 8) {
      throw new ExtensionMediaProcessError(
        'invalid_analysis_output',
        'Audio has insufficient bounded evidence for synchronization'
      )
    }
    return {
      source: sourceEvidence(source),
      features: extracted.features,
      analyzedDurationMicros: extracted.analyzedDurationMicros,
      truncated: durationMicros > extracted.analyzedDurationMicros ||
        durationMicros > input.maximumDurationMicros
    }
  }

  /**
   * Decode a bounded mono PCM envelope and derive conservative beat/downbeat
   * evidence inside Kun. FFmpeg never chooses the algorithm and extensions
   * cannot supply paths, filters, executable arguments, thresholds, or tempo.
   * Ambiguous material returns an empty grid instead of fabricated markers.
   */
  async analyzeBeatGridForCore(
    principal: ExtensionPrincipal,
    handleId: string,
    input: {
      maxMarkers: number
      signal?: AbortSignal
    }
  ): Promise<ExtensionBeatGridAnalysis> {
    requireProcessPermission(principal)
    const source = await this.options.handleService.resolve(principal, handleId, 'read')
    assertSafeAnalysisInput(source)
    const probe = await this.probe(principal, handleId, { signal: input.signal })
    const durationMicros = audioDurationMicros(probe)
    if (!probe.streams.some(({ kind }) => kind === 'audio') || durationMicros === undefined) {
      throw new ExtensionMediaProcessError(
        'invalid_analysis_output',
        'Local beat analysis requires an audio stream with a positive duration'
      )
    }
    const maximumDurationMicros = Math.min(durationMicros, BEAT_MAX_ANALYSIS_MICROS)
    const executable = await this.requireExecutable('ffmpeg')
    const result = await this.processRunner(executable.path, [
      '-v', 'error',
      '-hide_banner',
      '-nostdin',
      '-protocol_whitelist', EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
      '-format_whitelist', EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
      '-i', source.absolutePath,
      '-map', '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-ac', '1',
      '-ar', String(BEAT_PCM_SAMPLE_RATE),
      '-t', microsSeconds(maximumDurationMicros),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ], {
      env: scrubbedEnvironment(this.pathEnv),
      timeoutMs: this.ffmpegTimeoutMs,
      maxStdoutBytes: beatPcmByteLimit(maximumDurationMicros),
      maxStderrBytes: this.maxDiagnosticBytes,
      signal: input.signal
    })
    if (result.exitCode !== 0) {
      throw new ExtensionMediaProcessError('process_failed', 'Local beat analysis failed')
    }
    const detected = detectBeatGridFromPcm(result.stdout, input.maxMarkers)
    return {
      source: sourceEvidence(source),
      ...(detected.tempoBpm === undefined ? {} : { tempoBpm: detected.tempoBpm }),
      markers: detected.markers,
      analyzedDurationMicros: detected.analyzedDurationMicros,
      truncated: detected.truncated || durationMicros > detected.analyzedDurationMicros
    }
  }

  /**
   * Decode real, Host-authorized visual frames with one fixed, path-opaque
   * FFmpeg profile and reduce the pixels to a bounded deterministic feature
   * vector. No frame bytes or local locations leave Kun.
   */
  async analyzeVisualFramesForCore(
    principal: ExtensionPrincipal,
    handleId: string,
    samples: readonly ExtensionVisualFrameSample[],
    options: { signal?: AbortSignal } = {}
  ): Promise<ExtensionVisualFrameAnalysis> {
    requireProcessPermission(principal)
    if (samples.length < 1 || samples.length > 16) {
      throw new ExtensionMediaProcessError(
        'invalid_analysis_output',
        'Local visual analysis requires 1 through 16 bounded frame samples'
      )
    }
    const sampleIds = new Set<string>()
    for (const sample of samples) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u.test(sample.sampleId) ||
        sampleIds.has(sample.sampleId) ||
        !Number.isSafeInteger(sample.startMicros) || sample.startMicros < 0 ||
        !Number.isSafeInteger(sample.endMicros) || sample.endMicros <= sample.startMicros ||
        !Number.isSafeInteger(sample.representativeMicros) ||
        sample.representativeMicros < sample.startMicros ||
        sample.representativeMicros >= sample.endMicros
      ) {
        throw new ExtensionMediaProcessError(
          'invalid_analysis_output',
          'Local visual frame sampling request is invalid'
        )
      }
      sampleIds.add(sample.sampleId)
    }
    const source = await this.options.handleService.resolve(principal, handleId, 'read')
    assertSafeAnalysisInput(source)
    const probe = await this.probe(principal, handleId, { signal: options.signal })
    if (!probe.streams.some(({ kind }) => kind === 'video')) {
      throw new ExtensionMediaProcessError(
        'invalid_analysis_output',
        'Local visual analysis requires a decodable visual stream'
      )
    }
    const durationMicros = visualDurationMicros(probe)
    if (
      durationMicros !== undefined &&
      samples.some(({ representativeMicros }) => representativeMicros >= durationMicros)
    ) {
      throw new ExtensionMediaProcessError(
        'invalid_analysis_output',
        'A requested visual sample is outside the authorized media duration'
      )
    }
    const executable = await this.requireExecutable('ffmpeg')
    const embeddings: ExtensionVisualFrameAnalysis['embeddings'] = []
    for (const sample of samples) {
      options.signal?.throwIfAborted()
      const result = await this.processRunner(executable.path, [
        '-v', 'error',
        '-hide_banner',
        '-nostdin',
        '-protocol_whitelist', EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
        '-format_whitelist', EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
        '-ss', microsSeekSeconds(sample.representativeMicros),
        '-i', source.absolutePath,
        '-map', '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-frames:v', '1',
        '-vf', 'scale=32:32:force_original_aspect_ratio=decrease,pad=32:32:(ow-iw)/2:(oh-ih)/2:black,format=rgb24',
        '-pix_fmt', 'rgb24',
        '-f', 'rawvideo',
        'pipe:1'
      ], {
        env: scrubbedEnvironment(this.pathEnv),
        timeoutMs: Math.min(this.ffmpegTimeoutMs, 60_000),
        maxStdoutBytes: VISUAL_FRAME_BYTES,
        maxStderrBytes: this.maxDiagnosticBytes,
        signal: options.signal
      })
      if (result.exitCode !== 0 || result.stdout.byteLength !== VISUAL_FRAME_BYTES) {
        throw new ExtensionMediaProcessError(
          'invalid_analysis_output',
          'Local visual frame decoding produced no valid bounded frame'
        )
      }
      embeddings.push({
        sampleId: sample.sampleId,
        vector: visualFeaturesFromRgb24(result.stdout, VISUAL_FRAME_WIDTH, VISUAL_FRAME_HEIGHT)
      })
    }
    options.signal?.throwIfAborted()
    // Re-resolve after every frame was consumed so a source replacement during
    // decoding cannot be published under the identity captured before decode.
    await this.options.handleService.resolve(principal, handleId, 'read')
    return {
      source: sourceEvidence(source),
      embeddings,
      decodedFrameWidth: VISUAL_FRAME_WIDTH,
      decodedFrameHeight: VISUAL_FRAME_HEIGHT
    }
  }

  /** Core-only execution primitive. Extension arguments must first pass the
   * handle-placeholder validator in ExtensionMediaFfmpegService. */
  async runFfmpegForCore(
    principal: ExtensionPrincipal,
    args: string[],
    options: { signal?: AbortSignal; onProgressChunk?: (chunk: Buffer) => void } = {}
  ): Promise<{ exitCode: number }> {
    requireProcessPermission(principal)
    const executable = await this.requireExecutable('ffmpeg')
    const result = await this.processRunner(executable.path, args, {
      env: scrubbedEnvironment(this.pathEnv),
      timeoutMs: this.ffmpegTimeoutMs,
      maxStdoutBytes: this.maxFfmpegProgressBytes,
      maxStderrBytes: this.maxFfmpegLogBytes,
      signal: options.signal,
      onStdoutChunk: options.onProgressChunk
    })
    return { exitCode: result.exitCode }
  }

  private async inspectExecutable(name: MediaExecutableName): Promise<MediaCapability> {
    const executable = await discoverExecutable(
      name,
      this.configuredPaths[name],
      this.pathEnv,
      this.discoveryDirectories
    )
    if (!executable) return { name, available: false }
    try {
      const result = await this.processRunner(executable.path, ['-version'], {
        env: scrubbedEnvironment(this.pathEnv),
        timeoutMs: this.discoveryTimeoutMs,
        maxStdoutBytes: this.maxDiagnosticBytes,
        maxStderrBytes: this.maxDiagnosticBytes
      })
      if (result.exitCode !== 0) return { name, available: false }
      const firstLine = result.stdout.toString('utf8').split(/\r?\n/u, 1)[0]?.trim() ?? ''
      const version = boundedVersion(firstLine, name)
      const features = name === 'ffmpeg'
          ? await inspectFfmpegFeatures(
            this.processRunner,
            executable.path,
            scrubbedEnvironment(this.pathEnv),
            this.discoveryTimeoutMs,
            this.maxDiagnosticBytes
          )
        : []
      return {
        name,
        available: true,
        source: executable.source,
        ...(version ? { version } : {}),
        ...(features.length > 0 ? { features } : {})
      }
    } catch {
      return { name, available: false }
    }
  }

  private async requireExecutable(name: MediaExecutableName): Promise<DiscoveredExecutable> {
    const executable = await discoverExecutable(
      name,
      this.configuredPaths[name],
      this.pathEnv,
      this.discoveryDirectories
    )
    if (!executable) {
      throw new ExtensionMediaProcessError(
        'executable_unavailable',
        `${name} is not available on this host`,
        true
      )
    }
    return executable
  }
}

async function inspectFfmpegFeatures(
  processRunner: typeof runBoundedProcess,
  executable: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  maxBytes: number
): Promise<NonNullable<MediaCapability['features']>> {
  try {
    const [encoders, filters, muxers] = await Promise.all([
      processRunner(executable, ['-hide_banner', '-encoders'], {
        env,
        timeoutMs,
        maxStdoutBytes: maxBytes,
        maxStderrBytes: maxBytes
      }),
      processRunner(executable, ['-hide_banner', '-filters'], {
        env,
        timeoutMs,
        maxStdoutBytes: maxBytes,
        maxStderrBytes: maxBytes
      }),
      processRunner(executable, ['-hide_banner', '-muxers'], {
        env,
        timeoutMs,
        maxStdoutBytes: maxBytes,
        maxStderrBytes: maxBytes
      })
    ])
    if (encoders.exitCode !== 0 || filters.exitCode !== 0 || muxers.exitCode !== 0) return []
    // FFmpeg variants do not consistently send capability inventories to the
    // same stream. In particular, Homebrew's full macOS build can print the
    // filter inventory on stderr even after a successful exit. Both streams
    // are independently bounded by the caller, so combine them only for the
    // local, token-based capability probe.
    const encoderText = capabilityInventoryText(encoders)
    const filterText = capabilityInventoryText(filters)
    const muxerText = capabilityInventoryText(muxers)
    const features: NonNullable<MediaCapability['features']> = []
    if (/^\s*[A-Z.]{6}\s+libx264\s/mu.test(encoderText)) features.push('libx264-encoder')
    if (/^\s*[A-Z.]{6}\s+libx265\s/mu.test(encoderText)) features.push('libx265-encoder')
    if (/^\s*[A-Z.]{6}\s+prores_ks\s/mu.test(encoderText)) features.push('prores-ks-encoder')
    if (/^\s*[A-Z.]{6}\s+ffv1\s/mu.test(encoderText)) features.push('ffv1-encoder')
    if (/^\s*[A-Z.]{6}\s+aac\s/mu.test(encoderText)) features.push('aac-encoder')
    if (/^\s*[A-Z.]{6}\s+flac\s/mu.test(encoderText)) features.push('flac-encoder')
    if (/^\s*[A-Z.]{6}\s+pcm_s24le\s/mu.test(encoderText)) features.push('pcm-s24-encoder')
    if (/^\s*[A-Z.]{6}\s+pcm_s16le\s/mu.test(encoderText)) features.push('pcm-s16-encoder')
    if (hasFfmpegFilter(filterText, 'drawtext')) features.push('drawtext-filter')
    if (hasFfmpegFilter(filterText, 'subtitles')) features.push('subtitles-filter')
    if (hasFfmpegFilter(filterText, 'eq')) features.push('eq-filter')
    if (hasFfmpegFilter(filterText, 'colorbalance')) features.push('colorbalance-filter')
    if (hasFfmpegFilter(filterText, 'boxblur')) features.push('boxblur-filter')
    if (hasFfmpegFilter(filterText, 'unsharp')) features.push('unsharp-filter')
    if (hasFfmpegFilter(filterText, 'vignette')) features.push('vignette-filter')
    if (hasFfmpegFilter(filterText, 'silencedetect')) features.push('silencedetect-filter')
    if (/^\s*[E.]\s+mp4(?:\s|,)/mu.test(muxerText)) features.push('mp4-muxer')
    if (/^\s*[E.]\s+mov(?:\s|,)/mu.test(muxerText)) features.push('mov-muxer')
    if (/^\s*[E.]\s+matroska(?:\s|,)/mu.test(muxerText)) features.push('matroska-muxer')
    if (/^\s*[E.]\s+s16le(?:\s|,)/mu.test(muxerText)) features.push('s16le-muxer')
    return features
  } catch {
    return []
  }
}

function capabilityInventoryText(result: RunResult): string {
  return Buffer.concat([result.stdout, Buffer.from('\n'), result.stderr]).toString('utf8')
}

function hasFfmpegFilter(inventory: string, name: string): boolean {
  // Filter flags are presentation metadata. Their width differs between
  // FFmpeg builds, so use the stable filter-name column instead.
  return new RegExp(`^\\s*(?:[A-Z.]+\\s+)?${name}(?:\\s|$)`, 'mu').test(inventory)
}

type DiscoveredExecutable = { path: string; source: 'configured' | 'path' }

async function discoverExecutable(
  name: MediaExecutableName,
  configuredPath: string | undefined,
  pathEnv: string,
  discoveryDirectories: readonly string[]
): Promise<DiscoveredExecutable | undefined> {
  if (configuredPath) {
    if (!isAbsolute(configuredPath)) return undefined
    const path = await executableRealpath(configuredPath)
    return path ? { path, source: 'configured' } : undefined
  }
  const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name]
  const directories = [...new Set([
    ...discoveryDirectories.slice(0, 32),
    ...pathEnv.split(delimiter).filter(Boolean).slice(0, 128)
  ])]
  for (const directory of directories) {
    if (!isAbsolute(directory)) continue
    for (const candidate of names) {
      const path = await executableRealpath(join(directory, candidate))
      if (path) return { path, source: 'path' }
    }
  }
  return undefined
}

/**
 * Desktop launches do not necessarily inherit an interactive shell PATH.
 * Search only fixed, reviewed installation prefixes in addition to PATH; the
 * resolved executable is still canonicalized and checked before use.
 */
export function defaultMediaDiscoveryDirectories(
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === 'darwin') {
    return [
      '/opt/homebrew/opt/ffmpeg-full/bin',
      '/usr/local/opt/ffmpeg-full/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/opt/local/bin'
    ]
  }
  if (platform === 'linux') return ['/usr/local/bin', '/usr/bin', '/snap/bin']
  return []
}

async function executableRealpath(candidate: string): Promise<string | undefined> {
  try {
    const path = await realpath(candidate)
    const info = await stat(path)
    if (!info.isFile()) return undefined
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return path
  } catch {
    return undefined
  }
}

function scrubbedEnvironment(pathEnv: string): NodeJS.ProcessEnv {
  return {
    PATH: pathEnv,
    LANG: 'C',
    LC_ALL: 'C',
    ...(process.platform === 'win32' && process.env.SystemRoot
      ? { SystemRoot: process.env.SystemRoot }
      : {})
  }
}

export async function runBoundedProcess(
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    timeoutMs: number
    maxStdoutBytes: number
    maxStderrBytes: number
    signal?: AbortSignal
    onStdoutChunk?: (chunk: Buffer) => void
  }
): Promise<RunResult> {
  if (options.signal?.aborted) {
    throw new ExtensionMediaProcessError('process_cancelled', 'Media process was cancelled')
  }
  return await new Promise<RunResult>((resolvePromise, rejectPromise) => {
    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env
      })
    } catch {
      rejectPromise(new ExtensionMediaProcessError('executable_unavailable', 'Media executable could not be started', true))
      return
    }
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let terminationReason: 'timeout' | 'cancelled' | 'limit' | undefined
    let forceTimer: NodeJS.Timeout | undefined

    const stop = (reason: typeof terminationReason) => {
      if (terminationReason) return
      terminationReason = reason
      terminateSpawnTree(child)
      forceTimer = setTimeout(() => terminateSpawnTree(child, { signal: 'SIGKILL' }), 500)
      forceTimer.unref?.()
    }
    const deadline = setTimeout(() => stop('timeout'), options.timeoutMs)
    deadline.unref?.()
    const abort = () => stop('cancelled')
    options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      stdoutBytes += chunk.length
      if (stdoutBytes > options.maxStdoutBytes) {
        stop('limit')
        return
      }
      stdout.push(chunk)
      options.onStdoutChunk?.(chunk)
    })
    child.stderr.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      stderrBytes += chunk.length
      if (stderrBytes > options.maxStderrBytes) {
        stop('limit')
        return
      }
      stderr.push(chunk)
    })
    child.once('error', () => {
      cleanup()
      if (settled) return
      settled = true
      rejectPromise(new ExtensionMediaProcessError('executable_unavailable', 'Media executable could not be started', true))
    })
    child.once('close', (code) => {
      cleanup()
      if (settled) return
      settled = true
      if (terminationReason === 'timeout') {
        rejectPromise(new ExtensionMediaProcessError('process_timeout', 'Media process timed out', true))
        return
      }
      if (terminationReason === 'cancelled') {
        rejectPromise(new ExtensionMediaProcessError('process_cancelled', 'Media process was cancelled'))
        return
      }
      if (terminationReason === 'limit') {
        rejectPromise(new ExtensionMediaProcessError('output_limit', 'Media process output exceeded its limit'))
        return
      }
      resolvePromise({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code ?? -1 })
    })

    function cleanup() {
      clearTimeout(deadline)
      if (forceTimer) clearTimeout(forceTimer)
      options.signal?.removeEventListener('abort', abort)
      child.stdout.destroy()
      child.stderr.destroy()
    }
  })
}

function assertSafeAnalysisInput(input: ResolvedMediaHandle): void {
  if (input.absolutePath.includes('%')) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio input name uses unsupported pattern syntax'
    )
  }
}

function sourceEvidence(input: ResolvedMediaHandle): ExtensionAudioSourceEvidence {
  if (!input.identity) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio source identity is unavailable'
    )
  }
  return {
    handleId: input.id,
    fingerprint: createHash('sha256')
      .update(
        `${input.identity.device ?? ''}\0${input.identity.inode ?? ''}\0${input.identity.size}\0${input.identity.mtimeMs}`
      )
      .digest('hex'),
    fingerprintAlgorithm: 'sha256-file-identity-v1'
  }
}

function audioDurationMicros(probe: MediaProbeMetadata): number | undefined {
  const values = [
    probe.container.durationMicros,
    ...probe.streams.filter(({ kind }) => kind === 'audio').map(({ durationMicros }) => durationMicros)
  ].filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)
  return values.length === 0 ? undefined : Math.max(...values)
}

function visualDurationMicros(probe: MediaProbeMetadata): number | undefined {
  const values = [
    probe.container.durationMicros,
    ...probe.streams.filter(({ kind }) => kind === 'video').map(({ durationMicros }) => durationMicros)
  ].filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)
  return values.length === 0 ? undefined : Math.max(...values)
}

function boundedDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio analysis threshold is invalid'
    )
  }
  return Number(value.toFixed(6)).toString()
}

function microsSeconds(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Audio analysis duration is invalid'
    )
  }
  return (value / 1_000_000).toFixed(6)
}

function microsSeekSeconds(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Visual sample timestamp is invalid'
    )
  }
  return (value / 1_000_000).toFixed(6)
}

/**
 * Deterministic, interpretable 24-dimensional RGB/luma/edge descriptor. This
 * is a measured pixel feature vector, not a synthetic semantic embedding.
 */
export function visualFeaturesFromRgb24(
  rgb: Buffer,
  width = VISUAL_FRAME_WIDTH,
  height = VISUAL_FRAME_HEIGHT
): number[] {
  if (
    !Number.isSafeInteger(width) || width < 2 || width > 512 ||
    !Number.isSafeInteger(height) || height < 2 || height > 512 ||
    rgb.byteLength !== width * height * 3
  ) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Decoded visual frame dimensions are invalid'
    )
  }
  const pixels = width * height
  const luma = new Float64Array(pixels)
  const histogram = [0, 0, 0, 0, 0]
  let red = 0
  let green = 0
  let blue = 0
  let saturation = 0
  let lumaTotal = 0
  let lumaSquares = 0
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 3
    const r = rgb[offset]! / 255
    const g = rgb[offset + 1]! / 255
    const b = rgb[offset + 2]! / 255
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    red += r
    green += g
    blue += b
    saturation += Math.max(r, g, b) - Math.min(r, g, b)
    lumaTotal += y
    lumaSquares += y * y
    luma[pixel] = y
    histogram[Math.min(4, Math.floor(y * 5))]! += 1
  }
  const meanRed = red / pixels
  const meanGreen = green / pixels
  const meanBlue = blue / pixels
  const brightness = lumaTotal / pixels
  const contrast = Math.min(1, Math.sqrt(Math.max(0, lumaSquares / pixels - brightness * brightness)) * 2)
  const meanSaturation = saturation / pixels
  let horizontalDifference = 0
  let horizontalCount = 0
  let verticalDifference = 0
  let verticalCount = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (x > 0) {
        verticalDifference += Math.abs(luma[index]! - luma[index - 1]!)
        verticalCount += 1
      }
      if (y > 0) {
        horizontalDifference += Math.abs(luma[index]! - luma[index - width]!)
        horizontalCount += 1
      }
    }
  }
  const horizontalEdge = Math.min(1, horizontalDifference / Math.max(1, horizontalCount) * 3)
  const verticalEdge = Math.min(1, verticalDifference / Math.max(1, verticalCount) * 3)
  const edgeDensity = Math.min(1, (horizontalEdge + verticalEdge) / 2)
  const warmth = clamp01((meanRed - meanBlue + 1) / 2)
  const coolness = clamp01((meanBlue - meanRed + 1) / 2)
  const vector = [
    meanRed,
    meanGreen,
    meanBlue,
    brightness,
    1 - brightness,
    meanSaturation,
    1 - meanSaturation,
    contrast,
    1 - contrast,
    edgeDensity,
    1 - edgeDensity,
    warmth,
    coolness,
    clamp01(meanRed - Math.max(meanGreen, meanBlue) + 0.5),
    clamp01(meanGreen - Math.max(meanRed, meanBlue) + 0.5),
    clamp01(meanBlue - Math.max(meanRed, meanGreen) + 0.5),
    histogram[0]! / pixels,
    histogram[1]! / pixels,
    histogram[2]! / pixels,
    histogram[3]! / pixels,
    histogram[4]! / pixels,
    horizontalEdge,
    verticalEdge,
    0.25
  ]
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON || vector.length !== VISUAL_FEATURE_DIMENSIONS) {
    throw new ExtensionMediaProcessError(
      'invalid_analysis_output',
      'Decoded visual frame did not produce valid measured features'
    )
  }
  return vector.map((value) => Number((value / magnitude).toFixed(8)))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function parseSilenceIntervals(
  diagnostics: string,
  durationMicros: number,
  minimumSilenceMicros: number,
  maxIntervals: number
): {
  intervals: ExtensionSilenceAnalysis['intervals']
  truncated: boolean
} {
  let openStartMicros: number | undefined
  let truncated = false
  const intervals: ExtensionSilenceAnalysis['intervals'] = []
  const append = (startMicros: number, endMicros: number): void => {
    const start = Math.max(0, Math.min(durationMicros, startMicros))
    const end = Math.max(start, Math.min(durationMicros, endMicros))
    if (end - start < minimumSilenceMicros) return
    if (intervals.length >= maxIntervals) {
      truncated = true
      return
    }
    intervals.push({
      startMicros: start,
      endMicros: end,
      confidence: 1,
      confidenceSemantics: 'threshold-classification'
    })
  }
  for (const line of diagnostics.split(/\r?\n/u)) {
    const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/u.exec(line)
    if (start) {
      const seconds = Number(start[1])
      if (Number.isFinite(seconds)) openStartMicros = Math.round(seconds * 1_000_000)
      continue
    }
    const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/u.exec(line)
    if (end && openStartMicros !== undefined) {
      const seconds = Number(end[1])
      if (Number.isFinite(seconds)) append(openStartMicros, Math.round(seconds * 1_000_000))
      openStartMicros = undefined
    }
  }
  if (openStartMicros !== undefined) append(openStartMicros, durationMicros)
  return { intervals, truncated }
}

function syncPcmByteLimit(durationMicros: number): number {
  return Math.min(
    2 * 1024 * 1024,
    Math.max(4_096, Math.ceil(durationMicros * SYNC_FEATURE_SAMPLE_RATE * 2 / 1_000_000) + 4_096)
  )
}

function beatPcmByteLimit(durationMicros: number): number {
  return Math.min(
    2 * 1024 * 1024,
    Math.max(4_096, Math.ceil(durationMicros * BEAT_PCM_SAMPLE_RATE * 2 / 1_000_000) + 4_096)
  )
}

type DetectedBeatGrid = Omit<ExtensionBeatGridAnalysis, 'source'>

/** Pure deterministic detector used by the Host boundary and fixture tests. */
export function detectBeatGridFromPcm(pcm: Buffer, maxMarkers: number): DetectedBeatGrid {
  const boundedMarkers = boundedInteger(maxMarkers, 2_000, 1, 4_096)
  const sampleCount = Math.floor(pcm.byteLength / 2)
  const samplesPerWindow = Math.max(
    1,
    Math.round(BEAT_PCM_SAMPLE_RATE * BEAT_WINDOW_MICROS / 1_000_000)
  )
  const windowCount = Math.floor(sampleCount / samplesPerWindow)
  const analyzedDurationMicros = Math.floor(sampleCount * 1_000_000 / BEAT_PCM_SAMPLE_RATE)
  if (windowCount < 40) {
    return { markers: [], analyzedDurationMicros, truncated: false }
  }

  const energy: number[] = []
  for (let window = 0; window < windowCount; window += 1) {
    let sumSquares = 0
    const start = window * samplesPerWindow
    for (let sample = start; sample < start + samplesPerWindow; sample += 1) {
      const normalized = pcm.readInt16LE(sample * 2) / 32_768
      sumSquares += normalized * normalized
    }
    energy.push(Math.sqrt(sumSquares / samplesPerWindow))
  }
  const positiveFlux = energy.map((value, index) =>
    index === 0 ? 0 : Math.max(0, value - energy[index - 1]!))
  const onset = positiveFlux.map((value, index) => {
    const start = Math.max(0, index - 8)
    const end = Math.min(positiveFlux.length, index + 9)
    let local = 0
    for (let candidate = start; candidate < end; candidate += 1) local += positiveFlux[candidate]!
    const baseline = local / Math.max(1, end - start)
    return Math.max(0, value - baseline * 1.15)
  })
  const maximumOnset = onset.reduce((maximum, value) => Math.max(maximum, value), 0)
  if (maximumOnset <= 1e-6) {
    return { markers: [], analyzedDurationMicros, truncated: false }
  }
  const normalized = onset.map((value) => value / maximumOnset)
  const energeticOnsets = normalized.filter((value) => value >= 0.35).length
  if (energeticOnsets < 4) {
    return { markers: [], analyzedDurationMicros, truncated: false }
  }

  const minimumLag = Math.max(2, Math.floor(60_000_000 / (BEAT_MAX_BPM * BEAT_WINDOW_MICROS)))
  const maximumLag = Math.min(
    normalized.length - 1,
    Math.ceil(60_000_000 / (BEAT_MIN_BPM * BEAT_WINDOW_MICROS))
  )
  let bestLag = 0
  let bestScore = 0
  let bestTempoDistance = Number.POSITIVE_INFINITY
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let numerator = 0
    let leftEnergy = 0
    let rightEnergy = 0
    for (let index = lag; index < normalized.length; index += 1) {
      const left = normalized[index]!
      const right = normalized[index - lag]!
      numerator += left * right
      leftEnergy += left * left
      rightEnergy += right * right
    }
    const score = leftEnergy <= Number.EPSILON || rightEnergy <= Number.EPSILON
      ? 0
      : numerator / Math.sqrt(leftEnergy * rightEnergy)
    const bpm = 60_000_000 / (lag * BEAT_WINDOW_MICROS)
    const tempoDistance = Math.abs(bpm - 120)
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && tempoDistance < bestTempoDistance)) {
      bestLag = lag
      bestScore = score
      bestTempoDistance = tempoDistance
    }
  }
  if (bestLag === 0 || bestScore < 0.2) {
    return { markers: [], analyzedDurationMicros, truncated: false }
  }

  let bestPhase = 0
  let bestPhaseScore = -1
  for (let phase = 0; phase < bestLag; phase += 1) {
    let score = 0
    let count = 0
    for (let index = phase; index < normalized.length; index += bestLag) {
      score += normalized[index]!
      count += 1
    }
    const average = score / Math.max(1, count)
    if (average > bestPhaseScore) {
      bestPhase = phase
      bestPhaseScore = average
    }
  }

  const beatFrames: number[] = []
  const strengths: number[] = []
  let lastFrame = -1
  for (let expected = bestPhase; expected < normalized.length; expected += bestLag) {
    let selected = expected
    for (let candidate = Math.max(0, expected - 2); candidate <= Math.min(normalized.length - 1, expected + 2); candidate += 1) {
      if (normalized[candidate]! > normalized[selected]!) selected = candidate
    }
    if (selected <= lastFrame || normalized[selected]! < 0.12) continue
    beatFrames.push(selected)
    strengths.push(normalized[selected]!)
    lastFrame = selected
  }
  if (beatFrames.length < 4) {
    return { markers: [], analyzedDurationMicros, truncated: false }
  }

  const meter = inferDownbeatMeter(strengths)
  const tempoBpm = Number((60_000_000 / (bestLag * BEAT_WINDOW_MICROS)).toFixed(6))
  const rawMarkers: DetectedBeatGrid['markers'] = beatFrames.map((frame, index) => {
    const strength = Number(Math.max(0, Math.min(1, strengths[index]!)).toFixed(6))
    const rhythmicConfidence = 0.55 + Math.min(0.35, bestScore * 0.35)
    const confidence = Number(Math.min(1, rhythmicConfidence + strength * 0.1).toFixed(6))
    const downbeat = meter !== undefined && index % meter.length === meter.phase
    return {
      timeMicros: Math.min(
        analyzedDurationMicros,
        Math.max(0, frame * BEAT_WINDOW_MICROS + Math.floor(BEAT_WINDOW_MICROS / 2))
      ),
      kind: downbeat ? 'downbeat' : 'beat',
      confidence: downbeat
        ? Number(Math.min(1, confidence * (0.9 + meter.contrast * 0.1)).toFixed(6))
        : confidence,
      strength
    }
  })
  return {
    tempoBpm,
    markers: rawMarkers.slice(0, boundedMarkers),
    analyzedDurationMicros,
    truncated: rawMarkers.length > boundedMarkers
  }
}

function inferDownbeatMeter(strengths: readonly number[]): {
  length: 3 | 4
  phase: number
  contrast: number
} | undefined {
  let best: { length: 3 | 4; phase: number; contrast: number } | undefined
  for (const length of [3, 4] as const) {
    if (strengths.length < length * 3) continue
    for (let phase = 0; phase < length; phase += 1) {
      const accented = strengths.filter((_value, index) => index % length === phase)
      const remainder = strengths.filter((_value, index) => index % length !== phase)
      const accentedMean = mean(accented)
      const remainderMean = mean(remainder)
      const contrast = (accentedMean - remainderMean) / Math.max(accentedMean, 1e-9)
      if (contrast >= 0.18 && (!best || contrast > best.contrast)) {
        best = { length, phase, contrast }
      }
    }
  }
  return best
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function pcmEnergyFeatures(
  pcm: Buffer,
  samplePeriodMicros: number,
  maxFeaturePoints: number
): { features: number[]; analyzedDurationMicros: number } {
  const sampleCount = Math.floor(pcm.byteLength / 2)
  const pointCount = Math.min(
    maxFeaturePoints,
    Math.floor(sampleCount * 1_000_000 / (SYNC_FEATURE_SAMPLE_RATE * samplePeriodMicros))
  )
  const energy: number[] = []
  for (let point = 0; point < pointCount; point += 1) {
    const start = Math.round(
      point * samplePeriodMicros * SYNC_FEATURE_SAMPLE_RATE / 1_000_000
    )
    const end = Math.min(
      sampleCount,
      Math.round((point + 1) * samplePeriodMicros * SYNC_FEATURE_SAMPLE_RATE / 1_000_000)
    )
    if (end <= start) break
    let sumSquares = 0
    for (let sample = start; sample < end; sample += 1) {
      const normalized = pcm.readInt16LE(sample * 2) / 32_768
      sumSquares += normalized * normalized
    }
    energy.push(Math.sqrt(sumSquares / (end - start)))
  }
  if (energy.length === 0) return { features: [], analyzedDurationMicros: 0 }
  const mean = energy.reduce((total, value) => total + value, 0) / energy.length
  const centered = energy.map((value) => value - mean)
  const scale = centered.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)
  const features = centered.map((value) =>
    scale <= Number.EPSILON ? 0 : Number((value / scale).toFixed(8))
  )
  return {
    features,
    analyzedDurationMicros: features.length * samplePeriodMicros
  }
}

function normalizeProbeJson(stdout: Buffer, input: ResolvedMediaHandle): MediaProbeMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.toString('utf8'))
  } catch {
    throw new ExtensionMediaProcessError('invalid_probe_output', 'Media probe returned invalid metadata')
  }
  if (!isRecord(parsed)) {
    throw new ExtensionMediaProcessError('invalid_probe_output', 'Media probe returned invalid metadata')
  }
  const rawFormat = isRecord(parsed.format) ? parsed.format : {}
  const formatNames = (boundedText(rawFormat.format_name, 4096) ?? '')
    .split(',')
    .map((value) => boundedText(value, 128))
    .filter((value): value is string => Boolean(value))
    .slice(0, 32)
  const formatLongName = boundedText(rawFormat.format_long_name, 256)
  const durationMicros = secondsToMicros(rawFormat.duration)
  const startTimeMicros = signedSecondsToMicros(rawFormat.start_time)
  const bitRate = positiveInteger(rawFormat.bit_rate, Number.MAX_SAFE_INTEGER)
  const rawStreams = Array.isArray(parsed.streams) ? parsed.streams.slice(0, 64) : []
  const streams = rawStreams.flatMap((value, fallbackIndex) => {
    if (!isRecord(value)) return []
    const index = nonnegativeInteger(value.index, fallbackIndex, 65_535)
    const kind = normalizedStreamKind(value.codec_type)
    const tags = isRecord(value.tags) ? value.tags : {}
    const disposition = isRecord(value.disposition) ? value.disposition : {}
    const frameRate = rational(value.avg_frame_rate) ?? rational(value.r_frame_rate)
    const stream: MediaProbeMetadata['streams'][number] = {
      index,
      kind,
      ...(boundedText(value.codec_name, 64) ? { codecName: boundedText(value.codec_name, 64) } : {}),
      ...(boundedText(value.codec_long_name, 256) ? { codecLongName: boundedText(value.codec_long_name, 256) } : {}),
      ...(rational(value.time_base) ? { timeBase: rational(value.time_base) } : {}),
      ...(frameRate ? { frameRate } : {}),
      ...(secondsToMicros(value.duration) !== undefined ? { durationMicros: secondsToMicros(value.duration) } : {}),
      ...(positiveInteger(value.width, 131_072) !== undefined ? { width: positiveInteger(value.width, 131_072) } : {}),
      ...(positiveInteger(value.height, 131_072) !== undefined ? { height: positiveInteger(value.height, 131_072) } : {}),
      ...(rotation(value, tags) !== undefined ? { rotationDegrees: rotation(value, tags) } : {}),
      ...(positiveInteger(value.channels, 1024) !== undefined ? { channelCount: positiveInteger(value.channels, 1024) } : {}),
      ...(positiveInteger(value.sample_rate, 10_000_000) !== undefined ? { sampleRate: positiveInteger(value.sample_rate, 10_000_000) } : {}),
      ...(boundedText(value.channel_layout, 128) ? { channelLayout: boundedText(value.channel_layout, 128) } : {}),
      ...(boundedText(tags.language, 32) ? { language: boundedText(tags.language, 32) } : {}),
      disposition: {
        default: booleanFlag(disposition.default) ?? false,
        forced: booleanFlag(disposition.forced) ?? false,
        attachedPicture: booleanFlag(disposition.attached_pic) ?? false
      }
    }
    return [stream]
  })
  return {
    schemaVersion: 1,
    handleId: input.id,
    container: {
      formatNames,
      ...(formatLongName ? { formatLongName } : {}),
      ...(durationMicros !== undefined ? { durationMicros } : {}),
      ...(startTimeMicros !== undefined ? { startTimeMicros } : {}),
      ...(bitRate !== undefined ? { bitRate } : {})
    },
    streams
  }
}

function normalizedStreamKind(value: unknown): MediaProbeMetadata['streams'][number]['kind'] {
  return value === 'video' || value === 'audio' || value === 'subtitle' ||
    value === 'data' || value === 'attachment' ? value : 'unknown'
}

function rational(value: unknown): { numerator: number; denominator: number } | undefined {
  const text = rationalText(value)
  if (!text) return undefined
  const [left, right] = text.split('/')
  const numerator = Number(left)
  const denominator = Number(right)
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
    numerator < 0 || denominator <= 0) return undefined
  return { numerator, denominator }
}

function rationalText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{1,10}\/\d{1,10}$/u.test(value)) return undefined
  return value
}

function secondsToMicros(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(number) || number < 0) return undefined
  const micros = Math.round(number * 1_000_000)
  return Number.isSafeInteger(micros) ? micros : undefined
}

function signedSecondsToMicros(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(number)) return undefined
  const micros = Math.round(number * 1_000_000)
  return Number.isSafeInteger(micros) ? micros : undefined
}

function rotation(stream: Record<string, unknown>, tags: Record<string, unknown>): number | undefined {
  const direct = typeof tags.rotate === 'string' || typeof tags.rotate === 'number' ? Number(tags.rotate) : Number.NaN
  if (Number.isInteger(direct) && direct >= -359 && direct <= 359) return direct
  if (!Array.isArray(stream.side_data_list)) return undefined
  for (const value of stream.side_data_list.slice(0, 16)) {
    if (!isRecord(value)) continue
    const candidate = typeof value.rotation === 'number' ? value.rotation : Number(value.rotation)
    if (Number.isInteger(candidate) && candidate >= -359 && candidate <= 359) return candidate
  }
  return undefined
}

function positiveInteger(value: unknown, max: number): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : undefined
}

function nonnegativeInteger(value: unknown, fallback: number, max: number): number {
  return positiveInteger(value, max) ?? fallback
}

function booleanFlag(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  return undefined
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = [...value.trim()].filter((character) => {
    const code = character.charCodeAt(0)
    return code > 31 && code !== 127
  }).join('')
  return text ? text.slice(0, max) : undefined
}

function boundedVersion(line: string, name: MediaExecutableName): string | undefined {
  const match = line.match(new RegExp(`^${name} version ([^\\s]+)`, 'u'))
  return match?.[1]?.slice(0, 64)
}

function requireProcessPermission(principal: ExtensionPrincipal): void {
  if (!principal.permissions.includes('media.process')) {
    throw new ExtensionMediaProcessError('permission_denied', 'Missing permission: media.process')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value!)))
}
