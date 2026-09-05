import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import { detectImage } from '../../attachments/attachment-store.js'
import type { ToolExecutionUpdate, ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import {
  ImageGenHttpError,
  describeNetworkError,
  type ProviderCredentialResolver
} from './image-gen-tool-provider.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'
import { LocalToolHost } from './local-tool-host.js'
import {
  createMusicGenClient,
  createSpeechGenClient
} from './media-gen-speech-clients.js'
import { createVideoGenClient } from './media-gen-video-clients.js'
import {
  normalizeAudioFormat,
  normalizeDuration,
  normalizeGrokVideoDuration,
  normalizeGrokVideoResolution,
  normalizeVolcengineVideoDuration,
  normalizeVolcengineVideoResolution
} from './media-gen-client-support.js'

export {
  MiniMaxMusicClient,
  MiniMaxSpeechClient,
  MimoSpeechClient,
  OpenAiCompatSpeechClient,
  createMusicGenClient,
  createSpeechGenClient
} from './media-gen-speech-clients.js'
export {
  GrokImagineVideoClient,
  MiniMaxVideoClient,
  VolcengineArkVideoClient,
  createVideoGenClient
} from './media-gen-video-clients.js'
export { volcengineArkVideoTasksUrl } from './media-gen-client-support.js'

const GENERATED_SPEECH_DIR = '.deepseekgui-audio'
const GENERATED_MUSIC_DIR = '.deepseekgui-music'
const GENERATED_VIDEO_DIR = '.deepseekgui-videos'
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
const REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const AUDIO_FORMATS = new Set(['mp3', 'wav', 'flac', 'pcm', 'pcm16'])
const VIDEO_RESOLUTIONS = ['768P', '1080P'] as const
const GROK_VIDEO_RESOLUTIONS = ['480P', '720P'] as const
const GROK_VIDEO_DURATIONS = [6, 10] as const
const GROK_VIDEO_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3'] as const
const VOLCENGINE_VIDEO_RESOLUTIONS = ['480P', '720P', '1080P', '4K'] as const
const VOLCENGINE_VIDEO_ASPECT_RATIOS = [
  'adaptive',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16'
] as const

export type GeneratedMedia = { data: Buffer; mimeType: string; extension: string }

export type SpeechGenRequest = {
  text: string
  model: string
  voice?: string
  style?: string
  format: string
  timeoutMs: number
  signal: AbortSignal
}

export type MusicGenRequest = {
  prompt?: string
  lyrics?: string
  instrumental?: boolean
  lyricsOptimizer?: boolean
  referenceAudioUrl?: string
  model: string
  format: string
  timeoutMs: number
  signal: AbortSignal
}

export type VideoGenRequest = {
  prompt: string
  model: string
  duration: number
  resolution: string
  aspectRatio?: string
  firstFrameImage?: { mimeType: string; data: Buffer }
  lastFrameImage?: { mimeType: string; data: Buffer }
  timeoutMs: number
  pollIntervalMs: number
  signal: AbortSignal
  onUpdate?: (update: ToolExecutionUpdate) => Promise<void> | void
}

export interface SpeechGenClient {
  id: string
  generate(request: SpeechGenRequest): Promise<GeneratedMedia>
}

export interface MusicGenClient {
  id: string
  generate(request: MusicGenRequest): Promise<GeneratedMedia>
}

export interface VideoGenClient {
  id: string
  generate(request: VideoGenRequest): Promise<GeneratedMedia>
}

export type SpeechGenDiagnostic = {
  id: 'speechGen'
  enabled: boolean
  available: boolean
  model?: string
  reason?: string
}

export type MusicGenDiagnostic = {
  id: 'musicGen'
  enabled: boolean
  available: boolean
  model?: string
  reason?: string
}

export type VideoGenDiagnostic = {
  id: 'videoGen'
  enabled: boolean
  available: boolean
  model?: string
  reason?: string
}

export type MediaGenToolProviderOptions = {
  speechClient?: SpeechGenClient
  musicClient?: MusicGenClient
  videoClient?: VideoGenClient
  nowIso?: () => string
  resolveCredential?: ProviderCredentialResolver
  /**
   * Provider-level model proxy. Custom inline configs have no provider
   * credential to resolve, so without this fallback their requests would
   * bypass the proxy that chat model requests honor.
   */
  proxyUrl?: string
}

export type SpeechGenToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: SpeechGenDiagnostic[]
  available: boolean
}

export type MusicGenToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: MusicGenDiagnostic[]
  available: boolean
}

export type VideoGenToolProviderBuildResult = {
  providers: CapabilityToolProvider[]
  diagnostics: VideoGenDiagnostic[]
  available: boolean
}

export function buildSpeechGenToolProviders(
  config: KunCapabilitiesConfig['speechGen'] | undefined,
  options: MediaGenToolProviderOptions = {}
): SpeechGenToolProviderBuildResult {
  if (!config?.enabled) return { providers: [], diagnostics: [], available: false }
  const missing = missingProviderFields(config, options.resolveCredential)
  if (missing.length > 0) {
    const reason = `speech generation provider is not configured (missing ${missing.join(', ')})`
    return {
      providers: [{ id: 'speechGen', kind: 'audio', enabled: true, available: false, reason, tools: [] }],
      diagnostics: [{ id: 'speechGen', enabled: true, available: false, model: config.model, reason }],
      available: false
    }
  }

  const model = config.model!

  const tool = LocalToolHost.defineTool({
    name: 'generate_speech',
    toolKind: 'file_change',
    description: [
      'Generate spoken audio from text using the configured text-to-speech provider.',
      `The generated audio is saved under ${GENERATED_SPEECH_DIR}/ in the workspace and returned as a generated file.`,
      'Use voice for a provider voice id/name and style for Xiaomi MiMo voice style instructions when needed.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to synthesize into speech' },
        voice: { type: 'string', description: 'Optional provider voice id/name' },
        style: { type: 'string', description: 'Optional voice style instruction for providers that support it' },
        format: { type: 'string', enum: [...AUDIO_FORMATS] }
      },
      required: ['text'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const text = pickString(args.text)
      if (!text) return toolError('invalid_text', 'text is required')
      const format = normalizeAudioFormat(pickString(args.format) || config.format)
      const voice = pickString(args.voice) || config.voice
      const style = pickString(args.style)
      let client = options.speechClient
      const requestTelemetry = () => telemetry(startedAt, client?.id ?? 'speech-provider')
      try {
        if (!client) {
          client = createSpeechGenClient(await resolveProviderCredential(config, options.resolveCredential, options.proxyUrl))
        }
        const media = await client.generate({
          text,
          model,
          ...(voice ? { voice } : {}),
          ...(style ? { style } : {}),
          format,
          timeoutMs: config.timeoutMs,
          signal: context.abortSignal
        })
        const file = await writeGeneratedMediaFile({
          context,
          data: media.data,
          mimeType: media.mimeType,
          extension: media.extension,
          dir: GENERATED_SPEECH_DIR,
          prefix: 'speech',
          nowIso: options.nowIso
        })
        return {
          output: {
            files: [file],
            model,
            voice,
            format,
            telemetry: requestTelemetry()
          }
        }
      } catch (error) {
        return toolError('generation_failed', providerErrorMessage(error), requestTelemetry())
      }
    }
  })

  return {
    providers: [{ id: 'speechGen', kind: 'audio', enabled: true, available: true, tools: [tool] }],
    diagnostics: [{ id: 'speechGen', enabled: true, available: true, model }],
    available: true
  }
}

export function buildMusicGenToolProviders(
  config: KunCapabilitiesConfig['musicGen'] | undefined,
  options: MediaGenToolProviderOptions = {}
): MusicGenToolProviderBuildResult {
  if (!config?.enabled) return { providers: [], diagnostics: [], available: false }
  const missing = missingProviderFields(config, options.resolveCredential)
  if (missing.length > 0) {
    const reason = `music generation provider is not configured (missing ${missing.join(', ')})`
    return {
      providers: [{ id: 'musicGen', kind: 'audio', enabled: true, available: false, reason, tools: [] }],
      diagnostics: [{ id: 'musicGen', enabled: true, available: false, model: config.model, reason }],
      available: false
    }
  }

  const model = config.model!

  const tool = LocalToolHost.defineTool({
    name: 'generate_music',
    toolKind: 'file_change',
    description: [
      'Generate a song or instrumental audio using the configured music provider.',
      `The generated audio is saved under ${GENERATED_MUSIC_DIR}/ in the workspace and returned as a generated file.`,
      'Provide prompt for style/intention, lyrics for sung music, or instrumental=true for instrumental tracks.'
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Musical style, mood, arrangement, or generation prompt' },
        lyrics: { type: 'string', description: 'Optional lyrics for sung music' },
        instrumental: { type: 'boolean', description: 'Generate instrumental music without vocals' },
        lyrics_optimizer: { type: 'boolean', description: 'Ask provider to generate or improve lyrics' },
        reference_audio_url: { type: 'string', description: 'Optional public URL for cover/reference audio' },
        format: { type: 'string', enum: [...AUDIO_FORMATS] }
      },
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context) => {
      const startedAt = Date.now()
      const prompt = pickString(args.prompt)
      const lyrics = pickString(args.lyrics)
      const instrumental = pickBoolean(args.instrumental)
      const lyricsOptimizer = pickBoolean(args.lyrics_optimizer)
      if (!prompt && !lyrics && instrumental !== true) {
        return toolError('invalid_music_request', 'provide prompt, lyrics, or instrumental=true')
      }
      const format = normalizeAudioFormat(pickString(args.format) || config.format)
      let client = options.musicClient
      const requestTelemetry = () => telemetry(startedAt, client?.id ?? 'music-provider')
      try {
        if (!client) {
          client = createMusicGenClient(await resolveProviderCredential(config, options.resolveCredential, options.proxyUrl))
        }
        const media = await client.generate({
          ...(prompt ? { prompt } : {}),
          ...(lyrics ? { lyrics } : {}),
          ...(instrumental !== undefined ? { instrumental } : {}),
          ...(lyricsOptimizer !== undefined ? { lyricsOptimizer } : {}),
          ...(pickString(args.reference_audio_url) ? { referenceAudioUrl: pickString(args.reference_audio_url) } : {}),
          model,
          format,
          timeoutMs: config.timeoutMs,
          signal: context.abortSignal
        })
        const file = await writeGeneratedMediaFile({
          context,
          data: media.data,
          mimeType: media.mimeType,
          extension: media.extension,
          dir: GENERATED_MUSIC_DIR,
          prefix: 'music',
          nowIso: options.nowIso
        })
        return {
          output: {
            files: [file],
            model,
            format,
            telemetry: requestTelemetry()
          }
        }
      } catch (error) {
        return toolError('generation_failed', providerErrorMessage(error), requestTelemetry())
      }
    }
  })

  return {
    providers: [{ id: 'musicGen', kind: 'audio', enabled: true, available: true, tools: [tool] }],
    diagnostics: [{ id: 'musicGen', enabled: true, available: true, model }],
    available: true
  }
}

export function buildVideoGenToolProviders(
  config: KunCapabilitiesConfig['videoGen'] | undefined,
  options: MediaGenToolProviderOptions = {}
): VideoGenToolProviderBuildResult {
  if (!config?.enabled) return { providers: [], diagnostics: [], available: false }
  const missing = missingProviderFields(config, options.resolveCredential)
  if (missing.length > 0) {
    const reason = `video generation provider is not configured (missing ${missing.join(', ')})`
    return {
      providers: [{ id: 'videoGen', kind: 'video', enabled: true, available: false, reason, tools: [] }],
      diagnostics: [{ id: 'videoGen', enabled: true, available: false, model: config.model, reason }],
      available: false
    }
  }

  const model = config.model!
  const isGrokImagine = config.protocol === 'grok-imagine-video'
  const isVolcengineArk = config.protocol === 'volcengine-ark-video'

  const tool = LocalToolHost.defineTool({
    name: 'generate_video',
    toolKind: 'file_change',
    description: [
      'Generate a video from a text prompt using the configured video provider.',
      isGrokImagine
        ? 'Optionally pass a workspace-relative first_frame_image_path for Grok image-to-video guidance.'
        : 'Optionally pass workspace-relative first_frame_image_path and last_frame_image_path for image-to-video guidance.',
      `The generated video is saved under ${GENERATED_VIDEO_DIR}/ in the workspace and returned as a generated file.`
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed video generation prompt' },
        duration: isGrokImagine
          ? { type: 'integer', enum: [...GROK_VIDEO_DURATIONS] }
          : isVolcengineArk
            ? { type: 'integer', minimum: 4, maximum: 15 }
            : { type: 'integer', minimum: 1, maximum: 30 },
        resolution: {
          type: 'string',
          enum: isGrokImagine
            ? [...GROK_VIDEO_RESOLUTIONS]
            : isVolcengineArk
              ? [...VOLCENGINE_VIDEO_RESOLUTIONS]
              : VIDEO_RESOLUTIONS
        },
        ...(isGrokImagine || isVolcengineArk
          ? {
              aspect_ratio: {
                type: 'string',
                enum: isVolcengineArk
                  ? [...VOLCENGINE_VIDEO_ASPECT_RATIOS]
                  : [...GROK_VIDEO_ASPECT_RATIOS],
                description: isVolcengineArk
                  ? 'Optional Seedance output ratio; adaptive lets the model choose.'
                  : 'Optional aspect ratio for Grok text-to-video generation.'
              }
            }
          : {}),
        first_frame_image_path: { type: 'string', description: 'Workspace-relative png/jpeg/webp first frame' },
        ...(!isGrokImagine
          ? {
              last_frame_image_path: {
                type: 'string',
                description: 'Workspace-relative png/jpeg/webp last frame'
              }
            }
          : {})
      },
      required: ['prompt'],
      additionalProperties: false
    },
    policy: 'untrusted',
    execute: async (args, context, onUpdate) => {
      const startedAt = Date.now()
      const prompt = pickString(args.prompt)
      if (!prompt) return toolError('invalid_prompt', 'prompt is required')
      const firstFrame = await collectFrameImage(args.first_frame_image_path, context, 'first_frame_image_path')
      if ('error' in firstFrame) return firstFrame.error
      const lastFrame = await collectFrameImage(args.last_frame_image_path, context, 'last_frame_image_path')
      if ('error' in lastFrame) return lastFrame.error
      const duration = isGrokImagine
        ? normalizeGrokVideoDuration(args.duration, config.defaultDuration)
        : isVolcengineArk
          ? normalizeVolcengineVideoDuration(args.duration, config.defaultDuration)
        : normalizeDuration(args.duration, config.defaultDuration)
      const resolution = isGrokImagine
        ? normalizeGrokVideoResolution(args.resolution, config.defaultResolution)
        : isVolcengineArk
          ? normalizeVolcengineVideoResolution(args.resolution, config.defaultResolution)
        : pickString(args.resolution) || config.defaultResolution
      const aspectRatio = pickString(args.aspect_ratio)
      let client = options.videoClient
      const requestTelemetry = () => telemetry(startedAt, client?.id ?? 'video-provider')
      try {
        if (!client) {
          client = createVideoGenClient(await resolveProviderCredential(config, options.resolveCredential, options.proxyUrl))
        }
        const media = await client.generate({
          prompt,
          model,
          duration,
          resolution,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(firstFrame.image ? { firstFrameImage: firstFrame.image } : {}),
          ...(lastFrame.image ? { lastFrameImage: lastFrame.image } : {}),
          timeoutMs: config.timeoutMs,
          pollIntervalMs: config.pollIntervalMs,
          signal: context.abortSignal,
          onUpdate
        })
        const file = await writeGeneratedMediaFile({
          context,
          data: media.data,
          mimeType: media.mimeType,
          extension: media.extension,
          dir: GENERATED_VIDEO_DIR,
          prefix: 'video',
          nowIso: options.nowIso
        })
        return {
          output: {
            files: [file],
            model,
            duration,
            resolution,
            telemetry: requestTelemetry()
          }
        }
      } catch (error) {
        return toolError('generation_failed', providerErrorMessage(error), requestTelemetry())
      }
    }
  })

  return {
    providers: [{ id: 'videoGen', kind: 'video', enabled: true, available: true, tools: [tool] }],
    diagnostics: [{ id: 'videoGen', enabled: true, available: true, model }],
    available: true
  }
}

function missingProviderFields(
  config: { baseUrl?: string; apiKey?: string; providerId?: string; model?: string },
  resolveCredential?: ProviderCredentialResolver
): string[] {
  return [
    !config.baseUrl ? 'baseUrl' : undefined,
    !config.apiKey && !(config.providerId && resolveCredential) ? 'apiKey' : undefined,
    !config.model ? 'model' : undefined
  ].filter((field): field is string => Boolean(field))
}

async function resolveProviderCredential<T extends {
  providerId?: string
  apiKey?: string
  headers?: Record<string, string>
}>(
  config: T,
  resolveCredential?: ProviderCredentialResolver,
  fallbackProxyUrl?: string
): Promise<T & {
  apiKey?: string
  headers?: Record<string, string>
  proxyUrl?: string
}> {
  const fallbackProxy = fallbackProxyUrl?.trim() ?? ''
  if (!config.providerId || !resolveCredential) {
    return fallbackProxy ? { ...config, proxyUrl: fallbackProxy } : config
  }
  const credential = await resolveCredential(config.providerId)
  // A resolved connection credential is authoritative: an empty proxyUrl means
  // the connection explicitly bypasses the app proxy, so do not fall back here.
  const proxyUrl = credential.proxyUrl?.trim() || ''
  return {
    ...config,
    apiKey: credential.apiKey,
    headers: { ...(config.headers ?? {}), ...(credential.headers ?? {}) },
    ...(proxyUrl ? { proxyUrl } : {})
  }
}

async function writeGeneratedMediaFile(input: {
  context: ToolHostContext
  data: Buffer
  mimeType: string
  extension: string
  dir: string
  prefix: string
  nowIso?: () => string
}): Promise<{
  relativePath: string
  absolutePath: string
  mimeType: string
  byteSize: number
}> {
  const stamp = (input.nowIso?.() ?? new Date().toISOString()).replace(/\D/g, '').slice(0, 14)
  const fileName = `${input.prefix}-${stamp}-${randomBytes(2).toString('hex')}.${input.extension}`
  const relativePath = `${input.dir}/${fileName}`
  const target = await resolveWorkspacePath(relativePath, input.context, { enforceWorkspaceBoundary: true })
  await mkdir(dirname(target.absolutePath), { recursive: true })
  const absolutePath = (await resolveWorkspacePath(relativePath, input.context, {
    enforceWorkspaceBoundary: true
  })).absolutePath
  await writeFile(absolutePath, input.data)
  return {
    relativePath,
    absolutePath,
    mimeType: input.mimeType,
    byteSize: input.data.byteLength
  }
}

type FrameImageResult = { image?: { mimeType: string; data: Buffer } }
type FrameImageError = { error: { output: unknown; isError: true } }

async function collectFrameImage(
  value: unknown,
  context: ToolHostContext,
  fieldName: string
): Promise<FrameImageResult | FrameImageError> {
  const rawPath = pickString(value)
  if (!rawPath) return {}
  let resolved: string
  try {
    resolved = (await resolveWorkspacePath(rawPath, context, { enforceWorkspaceBoundary: true })).absolutePath
  } catch {
    return { error: toolError('invalid_reference_path', `${fieldName} must be inside the workspace: ${rawPath}`) }
  }
  let data: Buffer
  try {
    data = await readFile(resolved)
  } catch {
    return { error: toolError('invalid_reference_path', `${fieldName} not found: ${rawPath}`) }
  }
  if (data.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    return { error: toolError('invalid_reference_path', `${fieldName} exceeds ${MAX_REFERENCE_IMAGE_BYTES} byte limit: ${rawPath}`) }
  }
  const detected = detectImage(data)
  if (!detected || !REFERENCE_MIME_TYPES.has(detected.mimeType)) {
    return { error: toolError('invalid_reference_path', `${fieldName} must be png, jpeg, or webp: ${rawPath}`) }
  }
  return { image: { mimeType: detected.mimeType, data } }
}


function telemetry(startedAt: number, provider: string): Record<string, unknown> {
  return { provider, durationMs: Date.now() - startedAt }
}

function toolError(code: string, message: string, toolTelemetry?: Record<string, unknown>): { output: unknown; isError: true } {
  return {
    output: {
      error: { code, message },
      ...(toolTelemetry ? { telemetry: toolTelemetry } : {})
    },
    isError: true
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function providerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
