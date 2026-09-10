import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_IMAGE_GENERATION_RESOLUTION,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_RESOLUTIONS,
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_KUN_PORT,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_PROMPT_OPTIMIZATION_PROMPT,
  MIN_KUN_LOCAL_PORT,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES,
  DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  MODEL_REASONING_REQUEST_PROTOCOLS,
  kunToolPermissionModeSettings,
  normalizeModelEndpointFormat,
  type AppSettingsV1,
  type KunComputerUseSettingsV1,
  type KunBrowserUseSettingsV1,
  type KunContextCompactionSettingsV1,
  type KunDesignQualitySettingsV1,
  type KunDesignQualityStrictness,
  type KunHistoryHygieneSettingsV1,
  type KunImageGenerationSettingsV1,
  type KunInstructionSettingsV1,
  type KunLabSettingsPatchV1,
  type KunLabSettingsV1,
  type KunLlmDebugSettingsV1,
  type ImageGenerationQuality,
  type ImageGenerationResolution,
  type KunMcpSearchSettingsV1,
  type KunProjectConfigSettingsV1,
  type KunMusicGenerationSettingsV1,
  type KunPromptOptimizationSettingsV1,
  type KunRuntimeTuningSettingsV1,
  type KunRuntimeSettingsPatchV1,
  type KunRuntimeSettingsV1,
  type KunSettingsEnvelopePatchV1,
  type KunSettingsEnvelopeV1,
  type KunSpeakSettingsV1,
  type KunSpeechToTextSettingsV1,
  type KunStorageSettingsV1,
  type KunToolOutputLimitsSettingsV1,
  type KunTextToSpeechSettingsV1,
  type KunTokenEconomySettingsV1,
  type KunVideoGenerationSettingsV1,
  type ImageGenerationProtocol,
  type MusicGenerationProtocol,
  type ModelProviderInputModality,
  type ModelProviderMessagePartSupport,
  type ModelProviderModelProfilePatchV1,
  type ModelProviderModelProfileV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelReasoningEffort,
  type ModelProviderSettingsV1,
  type SpeechToTextProtocol,
  type TextToSpeechProtocol,
  type VideoGenerationProtocol,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from './app-settings-types'
import {
  defaultKunGraphSettings,
  normalizeKunGraphSettings
} from './app-settings-graph'
import {
  normalizeModelProviderSettings,
  resolveKunRuntimeSettings
} from './app-settings-provider'
import {
  LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
  isLocalWhisperDownloadSourceId
} from './local-whisper'
import {
  isLocalKokoroDownloadSourceId,
  isLocalKokoroModelId
} from './local-kokoro'
import { isLocalKokoroVoiceId } from './local-kokoro-voices'

import {
  defaultKunBrowserUseSettings,
  defaultKunComputerUseSettings,
  defaultKunImageGenerationSettings,
  defaultKunMusicGenerationSettings,
  defaultKunPromptOptimizationSettings,
  defaultKunSpeakSettings,
  defaultKunSpeechToTextSettings,
  defaultKunTextToSpeechSettings,
  defaultKunVideoGenerationSettings
} from './app-settings-kun-defaults'
import {
  boundedPositiveInt
} from './app-settings-kun-tuning'

export function normalizeKunImageGenerationSettings(
  input: Partial<KunImageGenerationSettingsV1> | undefined
): KunImageGenerationSettingsV1 {
  const defaults = defaultKunImageGenerationSettings()
  const defaultSize = typeof input?.defaultSize === 'string' ? input.defaultSize.trim() : ''
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunImageGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultResolution: normalizeKunImageGenerationResolution(input?.defaultResolution),
    defaultSize: /^(auto|\d+x\d+)$/.test(defaultSize) ? defaultSize : '',
    quality: normalizeKunImageGenerationQuality(input?.quality),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

export function normalizeKunImageGenerationResolution(value: unknown): ImageGenerationResolution {
  return IMAGE_GENERATION_RESOLUTIONS.includes(value as ImageGenerationResolution)
    ? value as ImageGenerationResolution
    : DEFAULT_IMAGE_GENERATION_RESOLUTION
}

export function normalizeKunImageGenerationQuality(value: unknown): ImageGenerationQuality {
  return IMAGE_GENERATION_QUALITIES.includes(value as ImageGenerationQuality)
    ? value as ImageGenerationQuality
    : 'auto'
}

export function normalizeKunImageGenerationProtocol(value: unknown): ImageGenerationProtocol {
  if (value === 'minimax-image') return 'minimax-image'
  if (value === 'codex-responses-image') return 'codex-responses-image'
  if (value === 'grok-imagine-image') return 'grok-imagine-image'
  if (value === 'volcengine-ark-image') return 'volcengine-ark-image'
  return DEFAULT_IMAGE_GENERATION_PROTOCOL
}

export function normalizeKunSpeechToTextSettings(
  input: Partial<KunSpeechToTextSettingsV1> | undefined
): KunSpeechToTextSettingsV1 {
  const defaults = defaultKunSpeechToTextSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunSpeechToTextProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    localWhisperDownloadSource: isLocalWhisperDownloadSourceId(input?.localWhisperDownloadSource)
      ? input.localWhisperDownloadSource
      : defaults.localWhisperDownloadSource,
    language: typeof input?.language === 'string' ? input.language.trim().toLowerCase().slice(0, 16) : defaults.language,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

export function normalizeKunSpeechToTextProtocol(value: unknown): SpeechToTextProtocol {
  if (value === 'local-whisper') return 'local-whisper'
  if (value === 'mimo-asr') return 'mimo-asr'
  if (value === 'xai-stt') return 'xai-stt'
  if (value === 'gemini-audio') return 'gemini-audio'
  if (value === 'gemini-cli-audio') return 'gemini-cli-audio'
  return DEFAULT_SPEECH_TO_TEXT_PROTOCOL
}

export function normalizeKunSpeakSettings(
  input: Partial<KunSpeakSettingsV1> | undefined
): KunSpeakSettingsV1 {
  const defaults = defaultKunSpeakSettings()
  return {
    enabled: input?.enabled !== false,
    model: isLocalKokoroModelId(input?.model) ? input.model : defaults.model,
    voice: isLocalKokoroVoiceId(input?.voice) ? input.voice : defaults.voice,
    speed: normalizeKokoroSpeed(input?.speed, defaults.speed),
    downloadSource: isLocalKokoroDownloadSourceId(input?.downloadSource)
      ? input.downloadSource
      : defaults.downloadSource,
    autoDownload: input?.autoDownload !== false,
    keepTracks: input?.keepTracks === true
  }
}

/** Kokoro accepts 0.5x-2x; anything outside that range is clamped. */
export function normalizeKokoroSpeed(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(2, Math.max(0.5, Math.round(parsed * 100) / 100))
}

export function normalizeKunTextToSpeechSettings(
  input: Partial<KunTextToSpeechSettingsV1> | undefined
): KunTextToSpeechSettingsV1 {
  const defaults = defaultKunTextToSpeechSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunTextToSpeechProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    voice: typeof input?.voice === 'string' ? input.voice.trim().slice(0, 128) : defaults.voice,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

export function normalizeKunTextToSpeechProtocol(value: unknown): TextToSpeechProtocol {
  return value === 'minimax-t2a' || value === 'mimo-tts'
    ? value
    : DEFAULT_TEXT_TO_SPEECH_PROTOCOL
}

export function normalizeKunPromptOptimizationSettings(
  input: Partial<KunPromptOptimizationSettingsV1> | undefined
): KunPromptOptimizationSettingsV1 {
  const defaults = defaultKunPromptOptimizationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    prompt: typeof input?.prompt === 'string' ? input.prompt.trim() : defaults.prompt,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 600_000)
  }
}

export function resolveKunPromptOptimizationPrompt(settings: KunRuntimeSettingsV1): string {
  const configured = settings.promptOptimization?.prompt?.trim() ?? ''
  return configured || DEFAULT_PROMPT_OPTIMIZATION_PROMPT
}

export function normalizeKunMusicGenerationSettings(
  input: Partial<KunMusicGenerationSettingsV1> | undefined
): KunMusicGenerationSettingsV1 {
  const defaults = defaultKunMusicGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunMusicGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    format: normalizeAudioFormat(input?.format, defaults.format),
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 900_000)
  }
}

export function normalizeKunMusicGenerationProtocol(value: unknown): MusicGenerationProtocol {
  return value === 'minimax-music' ? 'minimax-music' : DEFAULT_MUSIC_GENERATION_PROTOCOL
}

export function normalizeKunVideoGenerationSettings(
  input: Partial<KunVideoGenerationSettingsV1> | undefined
): KunVideoGenerationSettingsV1 {
  const defaults = defaultKunVideoGenerationSettings()
  return {
    enabled: input?.enabled === true,
    providerId: typeof input?.providerId === 'string' ? input.providerId.trim() : defaults.providerId,
    protocol: normalizeKunVideoGenerationProtocol(input?.protocol),
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : defaults.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    defaultDuration: boundedPositiveInt(input?.defaultDuration, defaults.defaultDuration, 60),
    defaultResolution: typeof input?.defaultResolution === 'string' && input.defaultResolution.trim()
      ? input.defaultResolution.trim().slice(0, 32)
      : defaults.defaultResolution,
    timeoutMs: boundedPositiveInt(input?.timeoutMs, defaults.timeoutMs, 1_800_000),
    pollIntervalMs: boundedPositiveInt(input?.pollIntervalMs, defaults.pollIntervalMs, 60_000)
  }
}

export function normalizeKunVideoGenerationProtocol(value: unknown): VideoGenerationProtocol {
  if (value === 'grok-imagine-video') return 'grok-imagine-video'
  if (value === 'volcengine-ark-video') return 'volcengine-ark-video'
  return value === 'minimax-video' ? 'minimax-video' : DEFAULT_VIDEO_GENERATION_PROTOCOL
}

export function normalizeKunComputerUseSettings(
  input: Partial<KunComputerUseSettingsV1> | undefined
): KunComputerUseSettingsV1 {
  const defaults = defaultKunComputerUseSettings()
  const mode = input?.mode === 'always' || input?.mode === 'off' || input?.mode === 'auto'
    ? input.mode
    : defaults.mode
  return {
    enabled: input?.enabled === true,
    mode,
    maxImageDimension: boundedPositiveInt(input?.maxImageDimension, defaults.maxImageDimension, 4096),
    maxActionsPerTurn: boundedPositiveInt(input?.maxActionsPerTurn, defaults.maxActionsPerTurn, 1000)
  }
}

export function normalizeKunBrowserUseSettings(
  input: Partial<KunBrowserUseSettingsV1> | undefined
): KunBrowserUseSettingsV1 {
  const defaults = defaultKunBrowserUseSettings()
  return {
    enabled: input?.enabled !== false,
    mode: input?.mode === 'local-development' ? 'local-development' : 'public',
    approvalMode: input?.approvalMode === 'always-ask' ? 'always-ask' : 'auto-safe',
    maxTabs: boundedPositiveInt(input?.maxTabs, defaults.maxTabs, 3),
    maxObservationActionsPerTurn: boundedPositiveInt(
      input?.maxObservationActionsPerTurn,
      defaults.maxObservationActionsPerTurn,
      100
    ),
    maxInteractionActionsPerTurn: boundedPositiveInt(
      input?.maxInteractionActionsPerTurn,
      defaults.maxInteractionActionsPerTurn,
      50
    ),
    maxSnapshotNodes: boundedPositiveInt(input?.maxSnapshotNodes, defaults.maxSnapshotNodes, 500),
    maxSnapshotTextChars: boundedPositiveInt(
      input?.maxSnapshotTextChars,
      defaults.maxSnapshotTextChars,
      50_000
    ),
    maxImageDimension: Math.max(
      320,
      boundedPositiveInt(input?.maxImageDimension, defaults.maxImageDimension, 2048)
    ),
    idleTimeoutMs: Math.max(
      30_000,
      boundedPositiveInt(input?.idleTimeoutMs, defaults.idleTimeoutMs, 30 * 60_000)
    )
  }
}

export function normalizeAudioFormat(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return /^(mp3|wav|flac|pcm16)$/.test(normalized) ? normalized : fallback
}
