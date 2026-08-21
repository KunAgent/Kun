import type { AppLocale } from './app-locales'
import type { GuiUpdateChannel } from './gui-update'
import type { KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import type { LocalWhisperDownloadSourceId } from './local-whisper'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../../kun/src/contracts/policy.js'
import type { ComputerUseMode } from '../../kun/src/contracts/capabilities.js'
import type { BrowserUseMode } from './browser-use'
import type { ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
import type { ToolOutputLimitsConfig } from '../../kun/src/contracts/tool-output-limits.js'

export {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  inferModelEndpointFormatFromUrl,
  isCustomModelEndpointFormat,
  MODEL_ENDPOINT_FORMATS,
  modelEndpointPath,
  normalizeModelEndpointFormat,
  resolveModelEndpointFormat,
  usesChatCompletionsShape
} from '../../kun/src/contracts/model-endpoint-format.js'

export { DEFAULT_GUI_UPDATE_CHANNEL, normalizeGuiUpdateChannel, type GuiUpdateChannel } from './gui-update'

export {
  APPROVAL_REVIEWERS,
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  KUN_TOOL_PERMISSION_MODES,
  ApprovalReviewerSchema,
  isKunFullAccessSettings,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  kunToolPermissionSettingsEqual,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type KunToolPermissionMode,
  type KunToolPermissionSettings,
  type KunToolPermissionSettingsInput,
  type SandboxMode
} from '../../kun/src/contracts/policy.js'

export {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  type ToolOutputLimitsConfig
} from '../../kun/src/contracts/tool-output-limits.js'

/**
 * Overall UI text scale factor (applied as `zoom` on the app shell).
 * Previously a fixed enum ('small' | 'medium' | 'large'); now a free numeric
 * factor so the user can pick any size. Legacy enum values are migrated on load.
 */
export type UiFontScale = number

export const UI_FONT_SCALE_MIN = 0.7

export const UI_FONT_SCALE_MAX = 1.4

export const DEFAULT_UI_FONT_SCALE = 0.82

/** Maps the retired small/medium/large presets to their old zoom factors. */
export const LEGACY_UI_FONT_SCALE_FACTORS = { small: 0.82, medium: 0.88, large: 1 } as const

/** Coerce any stored/legacy value into a valid numeric scale factor. */
export function normalizeUiFontScale(value: unknown): UiFontScale {
  if (typeof value === 'string' && value in LEGACY_UI_FONT_SCALE_FACTORS) {
    return LEGACY_UI_FONT_SCALE_FACTORS[value as keyof typeof LEGACY_UI_FONT_SCALE_FACTORS]
  }
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return DEFAULT_UI_FONT_SCALE
  return Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, Math.round(num * 100) / 100))
}

/** Max width of the main chat message column, in CSS pixels. */
export type ChatContentMaxWidthPx = number

export const CHAT_CONTENT_MAX_WIDTH_MIN = 640

export const CHAT_CONTENT_MAX_WIDTH_MAX = 1200

export const DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX = 896

export function normalizeChatContentMaxWidth(value: unknown): ChatContentMaxWidthPx {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX
  return Math.min(
    CHAT_CONTENT_MAX_WIDTH_MAX,
    Math.max(CHAT_CONTENT_MAX_WIDTH_MIN, Math.round(num / 8) * 8)
  )
}

/** Which key combination sends from the chat composer. The other inserts a newline. */
export const COMPOSER_SEND_KEYS = ['enter', 'shiftEnter'] as const

export type ComposerSendKey = (typeof COMPOSER_SEND_KEYS)[number]

export const DEFAULT_COMPOSER_SEND_KEY: ComposerSendKey = 'enter'

export function normalizeComposerSendKey(value: unknown): ComposerSendKey {
  return value === 'shiftEnter' ? 'shiftEnter' : DEFAULT_COMPOSER_SEND_KEY
}

export function isComposerSendHotkey(
  event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  sendKey: ComposerSendKey = DEFAULT_COMPOSER_SEND_KEY
): boolean {
  if (event.key !== 'Enter' || event.metaKey || event.ctrlKey) return false
  return sendKey === 'shiftEnter' ? event.shiftKey : !event.shiftKey
}

export type ScheduleRunMode = 'agent' | 'plan'

export type ScheduleKind = 'manual' | 'interval' | 'daily' | 'at'

export type ScheduleTaskStatus = 'idle' | 'queued' | 'running' | 'success' | 'error'

export type ScheduleModel = 'deepseek-v4-pro' | 'deepseek-v4-flash'

export type ScheduleReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'

export type ClawRunMode = ScheduleRunMode

export type ClawImProvider = 'feishu' | 'weixin' | 'telegram'

export type ClawScheduleKind = ScheduleKind

export type ClawTaskStatus = ScheduleTaskStatus

export type ClawModel = 'auto' | ScheduleModel

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export const CUSTOM_IMAGE_GENERATION_PROVIDER_ID = 'custom'

export const IMAGE_GENERATION_PROTOCOLS = [
  'openai-images',
  'minimax-image',
  'codex-responses-image',
  'grok-imagine-image',
  'volcengine-ark-image'
] as const

export type ImageGenerationProtocol = (typeof IMAGE_GENERATION_PROTOCOLS)[number]

export const DEFAULT_IMAGE_GENERATION_PROTOCOL: ImageGenerationProtocol = 'openai-images'

export const IMAGE_GENERATION_RESOLUTIONS = ['auto', '1K', '2K', '3K', '4K'] as const

export type ImageGenerationResolution = (typeof IMAGE_GENERATION_RESOLUTIONS)[number]

export const DEFAULT_IMAGE_GENERATION_RESOLUTION: ImageGenerationResolution = '1K'

export const IMAGE_GENERATION_QUALITIES = ['auto', 'low', 'medium', 'high'] as const

export type ImageGenerationQuality = (typeof IMAGE_GENERATION_QUALITIES)[number]

export const CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID = 'custom'

export const SPEECH_TO_TEXT_PROTOCOLS = [
  'openai-transcriptions',
  'mimo-asr',
  'xai-stt',
  'gemini-audio',
  'gemini-cli-audio',
  'local-whisper'
] as const

export type SpeechToTextProtocol = (typeof SPEECH_TO_TEXT_PROTOCOLS)[number]

export const DEFAULT_SPEECH_TO_TEXT_PROTOCOL: SpeechToTextProtocol = 'openai-transcriptions'

export const CUSTOM_TEXT_TO_SPEECH_PROVIDER_ID = 'custom'

export const TEXT_TO_SPEECH_PROTOCOLS = ['openai-speech', 'minimax-t2a', 'mimo-tts'] as const

export type TextToSpeechProtocol = (typeof TEXT_TO_SPEECH_PROTOCOLS)[number]

export const DEFAULT_TEXT_TO_SPEECH_PROTOCOL: TextToSpeechProtocol = 'openai-speech'

export const CUSTOM_MUSIC_GENERATION_PROVIDER_ID = 'custom'

export const MUSIC_GENERATION_PROTOCOLS = ['minimax-music'] as const

export type MusicGenerationProtocol = (typeof MUSIC_GENERATION_PROTOCOLS)[number]

export const DEFAULT_MUSIC_GENERATION_PROTOCOL: MusicGenerationProtocol = 'minimax-music'

export const CUSTOM_VIDEO_GENERATION_PROVIDER_ID = 'custom'

export const VIDEO_GENERATION_PROTOCOLS = [
  'minimax-video',
  'grok-imagine-video',
  'volcengine-ark-video'
] as const

export type VideoGenerationProtocol = (typeof VIDEO_GENERATION_PROTOCOLS)[number]

export const DEFAULT_VIDEO_GENERATION_PROTOCOL: VideoGenerationProtocol = 'minimax-video'

export const DEFAULT_CLAW_MODEL = 'auto'

export const CLAW_MODEL_IDS = ['auto', 'deepseek-v4-pro', 'deepseek-v4-flash'] as const

export const DEFAULT_CLAW_RECENT_THREAD_LIST_LIMIT = 5

export const DEFAULT_SCHEDULE_MODEL = 'deepseek-v4-flash'

export const SCHEDULE_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const

export const DEFAULT_SCHEDULE_REASONING_EFFORT = 'medium'

export const SCHEDULE_REASONING_EFFORT_IDS = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const

export const MIN_KUN_LOCAL_PORT = 10_000

export const DEFAULT_SCHEDULE_INTERNAL_PORT = 18788

// 这些默认目录与 legacy-data-migration.ts 的 HOME_DATA_MIGRATION_MAPPINGS
// 一一对应:老安装的 ~/.deepseekgui/* 在启动期被搬到这里。
export const DEFAULT_WRITE_WORKSPACE_ROOT = '~/.kun/write_workspace'

// 对话工作目录的默认值按平台不同:macOS/Windows 用 ~/Documents/Kun,
// Linux 用 ~/.local/share/Kun/conversations。该默认值由 main 层
// (DEFAULT_CONVERSATION_WORKSPACE_ROOT_ABSOLUTE)和 renderer 层
// (defaultConversationWorkspaceRoot)各自按平台推导。
export const DEFAULT_KUN_DATA_DIR = '~/.kun/data'

export const DEFAULT_KUN_MODEL = 'deepseek-v4-pro'

export const DEFAULT_PROMPT_OPTIMIZATION_PROMPT = [
  'You rewrite rough spoken or typed instructions into a clear prompt for a coding agent.',
  'Keep the user intent, constraints, names, paths, and concrete details intact.',
  'Make the prompt actionable, concise, and well structured.',
  'Do not add requirements the user did not ask for.',
  'Return only the rewritten prompt text. Do not add markdown fences or explanations.'
].join('\n')

export const DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL = 'https://api.deepseek.com/beta'

export const DEFAULT_WRITE_INLINE_COMPLETION_MODEL = 'deepseek-v4-flash'

export const WRITE_INLINE_COMPLETION_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const

export const DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS = 650

export const DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE = 0.52

export const DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS = 96

export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS = 2_800

export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE = 0.36

export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS = 256

export const MIN_WRITE_AUTOSAVE_DELAY_MS = 5_000

export const MAX_WRITE_AUTOSAVE_DELAY_MS = 1_800_000

export const DEFAULT_WRITE_AUTOSAVE_DELAY_MS = 180_000

export const DEFAULT_KUN_PORT = 18899

export const DEFAULT_LOG_RETENTION_DAYS = 3

export const CHECKPOINT_CLEANUP_INTERVAL_DAYS = [1, 2, 3, 5, 10] as const

export type CheckpointCleanupIntervalDays = (typeof CHECKPOINT_CLEANUP_INTERVAL_DAYS)[number]

export const DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS: CheckpointCleanupIntervalDays = 3

// Checkpoint cleanup is enabled by default so stale Git checkpoint directories
// do not accumulate. Users who want to keep every checkpoint can opt out in settings.
export const DEFAULT_CHECKPOINT_CLEANUP_ENABLED = true

/** Keep Git checkpoint creation opt-in so storage does not grow unexpectedly. */
export const DEFAULT_GIT_CHECKPOINT_CREATE_ENABLED = false

/** Issue #1156: hard cap on total checkpoint bytes across all threads. */
export const DEFAULT_CHECKPOINT_MAX_TOTAL_BYTES = 2 * 1_024 * 1_024 * 1_024

/** Issue #1156: skip checkpoint creation below this much free disk space. */
export const DEFAULT_CHECKPOINT_MIN_FREE_DISK_BYTES = 1 * 1_024 * 1_024 * 1_024

export const DEFAULT_GIT_BRANCH_PREFIX = 'codex/'

export const DEFAULT_CURSOR_SPOTLIGHT_COLOR = '#85c1f1'

export const DEFAULT_WEIXIN_BRIDGE_RPC_URL = 'http://127.0.0.1:18790/api/v1/admin/rpc'

export const DEFAULT_MODEL_PROVIDER_ID = 'deepseek'

export const NETWORK_PROXY_PROTOCOLS = ['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h'] as const

export type NetworkProxyProtocol = (typeof NETWORK_PROXY_PROTOCOLS)[number]

export type NetworkProxySettingsV1 = {
  enabled: boolean
  url: string
}

export type { ModelEndpointFormat }

/** Number of retries after the initial model-provider request. */
export const DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS = 5

export const DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS = 3_000

export const DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES = [429, 500, 502, 503, 504] as const

export const MODEL_REQUEST_RETRY_DEFAULTS_VERSION = 1

export type ModelRequestRetrySettingsV1 = {
  maxAttempts: number
  initialDelayMs: number
  httpStatusCodes: number[]
  /** Tracks which materialized default status list has been applied. */
  defaultsVersion?: number
}

export const MODEL_PROVIDER_INPUT_MODALITIES = ['text', 'image'] as const

export type ModelProviderInputModality = (typeof MODEL_PROVIDER_INPUT_MODALITIES)[number]

export const MODEL_PROVIDER_MESSAGE_PARTS = ['text', 'image_url', 'input_image'] as const

export type ModelProviderMessagePartSupport = (typeof MODEL_PROVIDER_MESSAGE_PARTS)[number]

export const MODEL_REASONING_EFFORTS = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const

export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number]

export const MODEL_SERVICE_TIERS = ['priority', 'flex'] as const

export type ModelServiceTier = (typeof MODEL_SERVICE_TIERS)[number]

export const MODEL_REASONING_REQUEST_PROTOCOLS = [
  'none',
  'deepseek-chat-completions',
  'glm-chat-completions',
  'mimo-chat-completions',
  'openai-chat-completions',
  'qwen-chat-completions',
  'thinking-toggle-chat-completions',
  'openai-responses',
  'anthropic-thinking'
] as const

export type ModelReasoningRequestProtocol = (typeof MODEL_REASONING_REQUEST_PROTOCOLS)[number]

export type ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ModelReasoningEffort[]
  defaultEffort: ModelReasoningEffort
  requestProtocol: ModelReasoningRequestProtocol
}

export type ModelProviderModelProfileV1 = {
  aliases?: string[]
  contextWindowTokens?: number
  maxOutputTokens?: number
  inputModalities: ModelProviderInputModality[]
  outputModalities: ModelProviderInputModality[]
  supportsToolCalling: boolean
  messageParts: ModelProviderMessagePartSupport[]
  reasoning?: ModelProviderReasoningCapabilityV1
  /** Provider-advertised request service tiers supported by this model. */
  serviceTiers?: ModelServiceTier[]
  /** Per-model wire-format override. Omitted means "inherit the provider's endpointFormat". */
  endpointFormat?: ModelEndpointFormat
  /**
   * Codex Responses Lite transport. Omitted means the standard Responses
   * request shape; this is preset metadata rather than a user-facing toggle.
   */
  responsesMode?: 'lite'
}

export type ModelProviderImageCapabilityV1 = {
  protocol: ImageGenerationProtocol
  baseUrl: string
  models: string[]
}

export type ModelProviderSpeechCapabilityV1 = {
  protocol: SpeechToTextProtocol
  baseUrl: string
  models: string[]
}

export type ModelProviderTextToSpeechCapabilityV1 = {
  protocol: TextToSpeechProtocol
  baseUrl: string
  models: string[]
}

export type ModelProviderMusicCapabilityV1 = {
  protocol: MusicGenerationProtocol
  baseUrl: string
  models: string[]
}

export type ModelProviderVideoCapabilityV1 = {
  protocol: VideoGenerationProtocol
  baseUrl: string
  models: string[]
}

export type ModelProviderPresetMode = 'api' | 'token-plan'

export type ModelProviderPresetSourceV1 = {
  presetId: string
  mode: ModelProviderPresetMode
}

export type ModelProviderProfileV1 = {
  id: string
  name: string
  /** Stable built-in preset identity, independent from a multi-account profile id/name. */
  presetSource?: ModelProviderPresetSourceV1
  apiKey: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  /** 模型请求遇到临时失败或限流响应时使用的 HTTP 重试策略。 */
  retry?: ModelRequestRetrySettingsV1
  /**
   * Transport kind. `agent-sdk` delegates whole turns to the embedded Claude
   * Agent SDK (Claude Pro/Max subscription); `apiKey` then carries the
   * CLAUDE_CODE_OAUTH_TOKEN (empty => host Claude Code login).
   * `antigravity-cli` delegates whole turns to Google's official Antigravity
   * CLI, which uses the user's Gemini subscription login. `gemini-cli-api`
   * reuses the official Gemini CLI OAuth login while Kun calls the Code Assist
   * API directly. The retired `gemini-code-assist` value is accepted only for
   * settings migration.
   * `cursor-sdk` delegates whole turns to the official Cursor SDK and requires
   * a Cursor API key in `apiKey`.
   */
  kind?: 'http' | 'agent-sdk' | 'antigravity-cli' | 'gemini-cli-api' | 'cursor-sdk' | 'gemini-code-assist'
  models: string[]
  modelProfiles: Record<string, ModelProviderModelProfileV1>
  image?: ModelProviderImageCapabilityV1
  speech?: ModelProviderSpeechCapabilityV1
  textToSpeech?: ModelProviderTextToSpeechCapabilityV1
  music?: ModelProviderMusicCapabilityV1
  video?: ModelProviderVideoCapabilityV1
}

export const MODEL_ROUTE_STRATEGIES = [
  'priority',
  'round-robin',
  'weighted-round-robin',
  'least-latency',
  'adaptive'
] as const

export type ModelRouteStrategy = (typeof MODEL_ROUTE_STRATEGIES)[number]

export type ModelRouteTargetV1 = {
  id: string
  providerId: string
  modelId: string
  enabled: boolean
  weight: number
}

export type ModelRouteTargetReferenceStatus = 'valid' | 'provider-missing' | 'model-missing'

export type ModelRouteTargetResolutionV1 = {
  status: ModelRouteTargetReferenceStatus
  provider?: ModelProviderProfileV1
  modelId?: string
}

export type ModelRouteFailurePolicyV1 = {
  failoverHttpStatusCodes: number[]
  failoverOnNetworkError: boolean
  failoverOnTimeout: boolean
  failoverOnAuthError: boolean
}

export type ModelRouteHealthPolicyV1 = {
  failureThreshold: number
  cooldownMs: number
  halfOpenMaxAttempts: number
}

export type ModelRoutePoolV1 = {
  id: string
  name: string
  modelId: string
  enabled: boolean
  strategy: ModelRouteStrategy
  targets: ModelRouteTargetV1[]
  failurePolicy: ModelRouteFailurePolicyV1
  healthPolicy: ModelRouteHealthPolicyV1
}

export type LocalModelGatewaySettingsV1 = {
  enabled: boolean
  name: string
}

export type ModelProviderSettingsV1 = {
  apiKey: string
  baseUrl: string
  proxy: NetworkProxySettingsV1
  providers: ModelProviderProfileV1[]
  routePools: ModelRoutePoolV1[]
  localGateway: LocalModelGatewaySettingsV1
}

export type ModelProviderImageCapabilityPatchV1 = Partial<ModelProviderImageCapabilityV1>

export type ModelProviderSpeechCapabilityPatchV1 = Partial<ModelProviderSpeechCapabilityV1>

export type ModelProviderTextToSpeechCapabilityPatchV1 = Partial<ModelProviderTextToSpeechCapabilityV1>

export type ModelProviderMusicCapabilityPatchV1 = Partial<ModelProviderMusicCapabilityV1>

export type ModelProviderVideoCapabilityPatchV1 = Partial<ModelProviderVideoCapabilityV1>

export type ModelProviderModelProfilePatchV1 = Partial<ModelProviderModelProfileV1>

export type ModelProviderProfilePatchV1 = Partial<Omit<ModelProviderProfileV1, 'image' | 'speech' | 'textToSpeech' | 'music' | 'video' | 'modelProfiles'>> & {
  retry?: Partial<ModelRequestRetrySettingsV1>
  modelProfiles?: Record<string, ModelProviderModelProfilePatchV1 | null>
  image?: ModelProviderImageCapabilityPatchV1 | null
  speech?: ModelProviderSpeechCapabilityPatchV1 | null
  textToSpeech?: ModelProviderTextToSpeechCapabilityPatchV1 | null
  music?: ModelProviderMusicCapabilityPatchV1 | null
  video?: ModelProviderVideoCapabilityPatchV1 | null
}

export type ModelProviderSettingsPatchV1 = Partial<
  Omit<ModelProviderSettingsV1, 'providers' | 'proxy' | 'routePools' | 'localGateway'>
> & {
  proxy?: Partial<NetworkProxySettingsV1>
  providers?: ModelProviderProfilePatchV1[]
  routePools?: Partial<ModelRoutePoolV1>[]
  localGateway?: Partial<LocalModelGatewaySettingsV1>
}
