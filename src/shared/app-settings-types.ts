import type { GuiUpdateChannel } from './gui-update'
import type { KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import type { LocalWhisperDownloadSourceId } from './local-whisper'
import type { ApprovalPolicy, SandboxMode } from '../../kun/src/contracts/policy.js'
import type { ComputerUseMode } from '../../kun/src/contracts/capabilities.js'
import type { ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
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
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type SandboxMode
} from '../../kun/src/contracts/policy.js'
export const KUN_TOOL_PERMISSION_MODES = ['always-ask', 'read-only', 'sensitive-ask', 'workspace-write', 'bypass'] as const
export type KunToolPermissionMode = (typeof KUN_TOOL_PERMISSION_MODES)[number]
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
export const IMAGE_GENERATION_PROTOCOLS = ['openai-images', 'minimax-image'] as const
export type ImageGenerationProtocol = (typeof IMAGE_GENERATION_PROTOCOLS)[number]
export const DEFAULT_IMAGE_GENERATION_PROTOCOL: ImageGenerationProtocol = 'openai-images'
export const CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID = 'custom'
export const SPEECH_TO_TEXT_PROTOCOLS = ['openai-transcriptions', 'mimo-asr', 'local-whisper'] as const
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
export const VIDEO_GENERATION_PROTOCOLS = ['minimax-video'] as const
export type VideoGenerationProtocol = (typeof VIDEO_GENERATION_PROTOCOLS)[number]
export const DEFAULT_VIDEO_GENERATION_PROTOCOL: VideoGenerationProtocol = 'minimax-video'
export const DEFAULT_CLAW_MODEL = 'auto'
export const CLAW_MODEL_IDS = ['auto', 'deepseek-v4-pro', 'deepseek-v4-flash'] as const
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
export const DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL = 'https://api.deepseek.com/beta'
export const DEFAULT_WRITE_INLINE_COMPLETION_MODEL = 'deepseek-v4-flash'
export const WRITE_INLINE_COMPLETION_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS = 650
export const DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE = 0.52
export const DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS = 96
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS = 2_800
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE = 0.36
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS = 256
export const DEFAULT_KUN_PORT = 18899
export const DEFAULT_LOG_RETENTION_DAYS = 3
export const CHECKPOINT_CLEANUP_INTERVAL_DAYS = [1, 2, 3, 5, 10] as const
export type CheckpointCleanupIntervalDays = (typeof CHECKPOINT_CLEANUP_INTERVAL_DAYS)[number]
export const DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS: CheckpointCleanupIntervalDays = 3
// Checkpoint cleanup is enabled by default so stale Git checkpoint directories
// do not accumulate. Users who want to keep every checkpoint can opt out in settings.
export const DEFAULT_CHECKPOINT_CLEANUP_ENABLED = true
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
export const MODEL_PROVIDER_INPUT_MODALITIES = ['text', 'image'] as const
export type ModelProviderInputModality = (typeof MODEL_PROVIDER_INPUT_MODALITIES)[number]
export const MODEL_PROVIDER_MESSAGE_PARTS = ['text', 'image_url', 'input_image'] as const
export type ModelProviderMessagePartSupport = (typeof MODEL_PROVIDER_MESSAGE_PARTS)[number]
export const MODEL_REASONING_EFFORTS = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number]
export const MODEL_REASONING_REQUEST_PROTOCOLS = [
  'none',
  'deepseek-chat-completions',
  'glm-chat-completions',
  'mimo-chat-completions',
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
  /** Per-model wire-format override. Omitted means "inherit the provider's endpointFormat". */
  endpointFormat?: ModelEndpointFormat
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
export type ModelProviderProfileV1 = {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  /**
   * Transport kind. `agent-sdk` delegates whole turns to the embedded Claude
   * Agent SDK (Claude Pro/Max subscription); `apiKey` then carries the
   * CLAUDE_CODE_OAUTH_TOKEN (empty => host Claude Code login). Absent = http.
   */
  kind?: 'http' | 'agent-sdk'
  models: string[]
  modelProfiles: Record<string, ModelProviderModelProfileV1>
  image?: ModelProviderImageCapabilityV1
  speech?: ModelProviderSpeechCapabilityV1
  textToSpeech?: ModelProviderTextToSpeechCapabilityV1
  music?: ModelProviderMusicCapabilityV1
  video?: ModelProviderVideoCapabilityV1
}
export type ModelProviderSettingsV1 = {
  apiKey: string
  baseUrl: string
  proxy: NetworkProxySettingsV1
  providers: ModelProviderProfileV1[]
}

export type ModelProviderImageCapabilityPatchV1 = Partial<ModelProviderImageCapabilityV1>
export type ModelProviderSpeechCapabilityPatchV1 = Partial<ModelProviderSpeechCapabilityV1>
export type ModelProviderTextToSpeechCapabilityPatchV1 = Partial<ModelProviderTextToSpeechCapabilityV1>
export type ModelProviderMusicCapabilityPatchV1 = Partial<ModelProviderMusicCapabilityV1>
export type ModelProviderVideoCapabilityPatchV1 = Partial<ModelProviderVideoCapabilityV1>
export type ModelProviderModelProfilePatchV1 = Partial<ModelProviderModelProfileV1>
export type ModelProviderProfilePatchV1 = Partial<Omit<ModelProviderProfileV1, 'image' | 'speech' | 'textToSpeech' | 'music' | 'video' | 'modelProfiles'>> & {
  modelProfiles?: Record<string, ModelProviderModelProfilePatchV1 | null>
  image?: ModelProviderImageCapabilityPatchV1 | null
  speech?: ModelProviderSpeechCapabilityPatchV1 | null
  textToSpeech?: ModelProviderTextToSpeechCapabilityPatchV1 | null
  music?: ModelProviderMusicCapabilityPatchV1 | null
  video?: ModelProviderVideoCapabilityPatchV1 | null
}
export type ModelProviderSettingsPatchV1 = Partial<
  Omit<ModelProviderSettingsV1, 'providers' | 'proxy'>
> & {
  proxy?: Partial<NetworkProxySettingsV1>
  providers?: ModelProviderProfilePatchV1[]
}

export type KunSubagentProfileV1 = {
  /** Stable key; becomes the Record key in kun SubagentsCapabilityConfig.profiles. */
  id: string
  enabled: boolean
  name: string
  description?: string
  /** Hex color for the GUI avatar chip. */
  color?: string
  /** 'subagent' = delegate_task only; 'primary' = session persona only; 'all' = both. */
  mode: 'subagent' | 'primary' | 'all'
  model?: string
  providerId?: string
  /** Appended to the base system prompt (augment, not replace). */
  systemPrompt?: string
  /** Prepended to the user prompt body to steer the child without changing the system fingerprint. */
  promptPreamble?: string
  /** 'readOnly' restricts child to read/grep/find/ls; 'inherit' passes all tools. */
  toolPolicy: 'readOnly' | 'inherit'
  /** Explicit allow-list; overrides toolPolicy when set. */
  allowedTools?: string[]
  /** Built-in tool names switched off for this profile (deny-list, layered on inherit). Empty/undefined = inherit all. */
  blockedTools?: string[]
  /** MCP server ids switched off for this profile (deny-list; the whole server toolset is hidden). */
  blockedMcpServers?: string[]
  /** Skill ids switched off for this profile (deny-list; default inherits every available skill). */
  blockedSkills?: string[]
  /** Reasoning depth applied to this profile's child model requests. Default 'off'. */
  reasoningEffort?: ModelReasoningEffort
}

export type KunSubagentsSettingsV1 = {
  enabled: boolean
  maxParallel?: number
  maxChildRuns?: number
  defaultToolPolicy?: 'readOnly' | 'inherit'
  defaultProfile?: string
  profiles: KunSubagentProfileV1[]
}

export type KunRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  /** Optional override. Leave empty to inherit the General model provider API key. */
  apiKey: string
  /** Optional override. Leave empty to inherit the General model provider Base URL. */
  baseUrl: string
  /** Selected General model provider profile. Empty or missing means the default provider. */
  providerId: string
  /** Effective model request format. Resolved from the selected model provider. */
  endpointFormat: ModelEndpointFormat
  runtimeToken: string
  dataDir: string
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  /** Compress safe tool context before each model call. */
  tokenEconomyMode: boolean
  /** Detailed token-saving behavior used when building Kun model requests. */
  tokenEconomy: KunTokenEconomySettingsV1
  /** When true, the runtime skips bearer-token auth. Local dev only. */
  insecure: boolean
  /** GUI-managed MCP progressive discovery/search settings written into Kun config.json. */
  mcpSearch: KunMcpSearchSettingsV1
  /** Persistent store backend used by Kun. */
  storage: KunStorageSettingsV1
  /** Fallback compaction thresholds and summary behavior. Per-model thresholds live in Kun config models.profiles. */
  contextCompaction: KunContextCompactionSettingsV1
  /** Low-level loop guards and model argument repair tuning. */
  runtimeTuning: KunRuntimeTuningSettingsV1
  /** OpenAI-compatible image generation provider shared by chat agents and Write image tools. */
  imageGeneration: KunImageGenerationSettingsV1
  /** Speech-to-text provider used for voice input in the composer. */
  speechToText: KunSpeechToTextSettingsV1
  /** Text-to-speech provider exposed to agents as generate_speech. */
  textToSpeech: KunTextToSpeechSettingsV1
  /** Music generation provider exposed to agents as generate_music. */
  musicGeneration: KunMusicGenerationSettingsV1
  /** Video generation provider exposed to agents as generate_video. */
  videoGeneration: KunVideoGenerationSettingsV1
  /** GUI-owned model capability profiles written into Kun `models.profiles`. */
  modelProfiles: Record<string, ModelProviderModelProfileV1>
  /** Whether long-term memory is enabled in the Kun runtime. */
  memoryEnabled: boolean
  /** Host computer-use (screenshot + mouse/keyboard control) settings. */
  computerUse: KunComputerUseSettingsV1
  /** First-party design-quality linter applied to frontend output. */
  quality: KunDesignQualitySettingsV1
  /** GUI-managed subagent profiles written into kun SubagentsCapabilityConfig. */
  subagents?: KunSubagentsSettingsV1
  /** Global small-model slot. Title & Summary default to this. Empty = follow main model. */
  smallModel?: string
  /** Provider id paired with smallModel for per-provider routing. */
  smallModelProviderId?: string
  /** Optional model override for thread title generation. Empty = smallModel || main model. */
  titleModel?: string
  /** Provider id paired with titleModel. */
  titleProviderId?: string
  /** Optional model override for whole-session summary generation. Empty = smallModel || main model. */
  summaryModel?: string
  /** Provider id paired with summaryModel. */
  summaryProviderId?: string
  /** Optional model override for the code-review subagent. Empty = smallModel || main model. */
  codeReviewModel?: string
  /** Provider id paired with codeReviewModel. */
  codeReviewProviderId?: string
  /** Reasoning depth for thread-title generation. Default 'off'. */
  titleReasoningEffort?: ModelReasoningEffort
  /** Reasoning depth for whole-session summary generation. Default 'off'. */
  summaryReasoningEffort?: ModelReasoningEffort
  /** Reasoning depth for the code-review subagent model call. Default 'off'. */
  codeReviewReasoningEffort?: ModelReasoningEffort
}

export function kunToolPermissionModeSettings(
  mode: KunToolPermissionMode
): Pick<KunRuntimeSettingsV1, 'approvalPolicy' | 'sandboxMode'> {
  switch (mode) {
    case 'always-ask':
      return { approvalPolicy: 'always', sandboxMode: 'danger-full-access' }
    case 'read-only':
      return { approvalPolicy: 'on-request', sandboxMode: 'danger-full-access' }
    case 'sensitive-ask':
      return { approvalPolicy: 'untrusted', sandboxMode: 'danger-full-access' }
    case 'workspace-write':
      return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }
    case 'bypass':
      return { approvalPolicy: 'auto', sandboxMode: 'danger-full-access' }
  }
}

export function kunToolPermissionModeFromSettings(
  settings: Pick<KunRuntimeSettingsV1, 'approvalPolicy' | 'sandboxMode'>
): KunToolPermissionMode {
  if (settings.approvalPolicy === 'always') return 'always-ask'
  if (settings.approvalPolicy === 'untrusted') return 'sensitive-ask'
  if (
    settings.approvalPolicy === 'auto' &&
    settings.sandboxMode === 'danger-full-access'
  ) {
    return 'bypass'
  }
  if (settings.sandboxMode === 'workspace-write') return 'workspace-write'
  return 'read-only'
}

/** Detection aggressiveness for the design-quality linter. */
export type KunDesignQualityStrictness = 'relaxed' | 'standard' | 'strict'

export type KunDesignQualitySettingsV1 = {
  /** Master switch. Off means the builtin design-quality hook never fires. */
  enabled: boolean
  strictness: KunDesignQualityStrictness
  /** Rule ids to suppress. */
  ignoreRules: string[]
  /** Relative-path glob patterns to skip. */
  ignoreFiles: string[]
  /** Cap on findings folded into a single tool result. */
  maxFindings: number
}

export type KunComputerUseSettingsV1 = {
  /** Master switch. Off means the computer_use tool is never registered. */
  enabled: boolean
  /**
   * `auto`: advertise only to vision (image-capable) models — a vision
   * model turns it on for itself. `always`: advertise to every model.
   * `off`: never advertise even when enabled.
   */
  mode: ComputerUseMode
  /** Longest screenshot edge (px); larger captures are downscaled for grounding. */
  maxImageDimension: number
  /** Hard cap on computer_use actions per turn. */
  maxActionsPerTurn: number
}

export type KunImageGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for image generation. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their image capability. */
  protocol: ImageGenerationProtocol
  /** Custom image API root, or an override for the selected provider image API root. */
  baseUrl: string
  /** Custom image API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  model: string
  /** Default "WxH" or "auto" used when the model omits aspect ratio and size. Empty means provider default. */
  defaultSize: string
  timeoutMs: number
}

export type KunSpeechToTextSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for speech recognition. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their speech capability. */
  protocol: SpeechToTextProtocol
  /** Custom speech API root, or an override for the selected provider speech API root. */
  baseUrl: string
  /** Custom speech API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  model: string
  /** Download source used when protocol is local-whisper. */
  localWhisperDownloadSource: LocalWhisperDownloadSourceId
  /** Language hint sent to the provider ("zh", "en", ...). Empty means auto-detect. */
  language: string
  timeoutMs: number
}

export type KunTextToSpeechSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for speech generation. Empty or "custom" uses the fields below. */
  providerId: string
  /** Request protocol used when providerId is custom. Provider presets override this with their TTS capability. */
  protocol: TextToSpeechProtocol
  /** Custom TTS API root, or an override for the selected provider TTS API root. */
  baseUrl: string
  /** Custom TTS API key override. Empty inherits the selected provider API key when providerId is set. */
  apiKey: string
  model: string
  /** Provider voice id/name. Empty means provider default. */
  voice: string
  /** Default output audio format such as mp3 or wav. */
  format: string
  timeoutMs: number
}

export type KunMusicGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for music generation. Empty or "custom" uses the fields below. */
  providerId: string
  protocol: MusicGenerationProtocol
  baseUrl: string
  apiKey: string
  model: string
  /** Default output audio format such as mp3 or wav. */
  format: string
  timeoutMs: number
}

export type KunVideoGenerationSettingsV1 = {
  enabled: boolean
  /** Existing provider profile to use for video generation. Empty or "custom" uses the fields below. */
  providerId: string
  protocol: VideoGenerationProtocol
  baseUrl: string
  apiKey: string
  model: string
  /** Default video duration in seconds. */
  defaultDuration: number
  /** Default provider resolution value, e.g. 1080P. */
  defaultResolution: string
  timeoutMs: number
  pollIntervalMs: number
}

export type KunMcpSearchMode = 'direct' | 'search' | 'auto'

export type KunMcpSearchSettingsV1 = {
  enabled: boolean
  mode: KunMcpSearchMode
  autoThresholdToolCount: number
  topKDefault: number
  topKMax: number
  minScore: number
}

export type KunStorageBackend = 'hybrid' | 'file'

export type KunStorageSettingsV1 = {
  backend: KunStorageBackend
  sqlitePath: string
}

export type KunCompactionSummaryMode = 'heuristic' | 'model'

export type KunHistoryHygieneSettingsV1 = {
  maxToolResultLines: number
  maxToolResultBytes: number
  maxToolResultTokens: number
  maxToolArgumentStringBytes: number
  maxToolArgumentStringTokens: number
  maxArrayItems: number
}

export type KunTokenEconomySettingsV1 = {
  enabled: boolean
  compressToolDescriptions: boolean
  compressToolResults: boolean
  conciseResponses: boolean
  historyHygiene: KunHistoryHygieneSettingsV1
}

export type KunContextCompactionSettingsV1 = {
  defaultSoftThreshold: number
  defaultHardThreshold: number
  summaryMode: KunCompactionSummaryMode
  summaryTimeoutMs: number
  summaryMaxTokens: number
  summaryInputMaxBytes: number
  /** Optional model override for context compaction (empty = follow default model). */
  summaryModel?: string
  /** Provider id paired with summaryModel for per-provider routing. */
  summaryProviderId?: string
}

export type KunToolStormSettingsV1 = {
  enabled: boolean
  windowSize: number
  threshold: number
}

export type KunToolArgumentRepairSettingsV1 = {
  maxStringBytes: number
}

export type KunRuntimeTuningSettingsV1 = {
  /**
   * Max idle gap (ms) between streaming chunks before a turn fails with
   * `stream_idle_timeout`. `0` disables the guard — useful for local LLM
   * servers that stay silent while prefilling a very large prompt.
   */
  streamIdleTimeoutMs: number
  toolStorm: KunToolStormSettingsV1
  toolArgumentRepair: KunToolArgumentRepairSettingsV1
}

/**
 * Compatibility shell kept because persisted settings still use the
 * `agents.kun` envelope. Prefer operating on the contained
 * `KunRuntimeSettingsV1` directly in new code.
 */
export type KunSettingsEnvelopeV1 = {
  kun: KunRuntimeSettingsV1
}

/** @deprecated Use `KunSettingsEnvelopeV1`. */
export type AgentRuntimeSettingsMapV1 = KunSettingsEnvelopeV1

export type KunRuntimeTuningSettingsPatchV1 = {
  streamIdleTimeoutMs?: number
  toolStorm?: Partial<KunToolStormSettingsV1>
  toolArgumentRepair?: Partial<KunToolArgumentRepairSettingsV1>
}

export type KunTokenEconomySettingsPatchV1 = Partial<
  Omit<KunTokenEconomySettingsV1, 'historyHygiene'>
> & {
  historyHygiene?: Partial<KunHistoryHygieneSettingsV1>
}

export type KunRuntimeSettingsPatchV1 = Partial<
  Omit<
    KunRuntimeSettingsV1,
    'mcpSearch' | 'storage' | 'contextCompaction' | 'runtimeTuning' | 'tokenEconomy' | 'imageGeneration' | 'speechToText' | 'textToSpeech' | 'musicGeneration' | 'videoGeneration' | 'computerUse' | 'quality' | 'modelProfiles'
  >
> & {
  mcpSearch?: Partial<KunMcpSearchSettingsV1>
  tokenEconomy?: KunTokenEconomySettingsPatchV1
  storage?: Partial<KunStorageSettingsV1>
  contextCompaction?: Partial<KunContextCompactionSettingsV1>
  runtimeTuning?: KunRuntimeTuningSettingsPatchV1
  imageGeneration?: Partial<KunImageGenerationSettingsV1>
  speechToText?: Partial<KunSpeechToTextSettingsV1>
  textToSpeech?: Partial<KunTextToSpeechSettingsV1>
  musicGeneration?: Partial<KunMusicGenerationSettingsV1>
  videoGeneration?: Partial<KunVideoGenerationSettingsV1>
  computerUse?: Partial<KunComputerUseSettingsV1>
  quality?: Partial<KunDesignQualitySettingsV1>
  modelProfiles?: Record<string, ModelProviderModelProfilePatchV1 | null>
}

export type KunSettingsEnvelopePatchV1 = {
  kun?: KunRuntimeSettingsPatchV1
}

export type LogConfigV1 = {
  enabled: boolean
  retentionDays: number
}

export type CheckpointCleanupConfigV1 = {
  enabled: boolean
  intervalDays: CheckpointCleanupIntervalDays
  /**
   * Optional override for the Git checkpoint storage directory (issue #651).
   * Lets users point checkpoints at another drive with more free space instead
   * of filling the system drive under the Kun data dir. Absent = default
   * (`<dataDir>/git-checkpoints`).
   */
  directory?: string
  /** Keep at most this many checkpoints per thread (oldest pruned). Absent = default 5. */
  maxPerThread?: number
}

export type NotificationConfigV1 = {
  turnComplete: boolean
}

export const WINDOW_CLOSE_ACTIONS = ['ask', 'tray', 'quit'] as const
export type WindowCloseAction = typeof WINDOW_CLOSE_ACTIONS[number]

export type AppBehaviorConfigV1 = {
  openAtLogin: boolean
  startMinimized: boolean
  closeAction?: WindowCloseAction
  /** Legacy compatibility field. New code should use closeAction. */
  closeToTray: boolean
}

export type ScheduleSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
  /**
   * Discovered skill roots the user turned off. Holds common-directory ids
   * (e.g. `global-codex`) and/or normalized absolute paths for custom dirs.
   */
  disabledDirs: string[]
}

export type ScheduledTaskScheduleV1 = {
  kind: ScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

export type ScheduledTaskV1 = {
  id: string
  title: string
  enabled: boolean
  prompt: string
  workspaceRoot: string
  /** Optional Claw IM channel whose persona/defaults should drive this scheduled task. */
  clawChannelId: string
  /** Selected model provider for this scheduled task. Empty means the current/default runtime provider. */
  providerId?: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  /** Higher-priority queued tasks run first. */
  priority?: number
  /** Task ids that must have completed successfully before this task runs. */
  dependsOn?: string[]
  /** Run the task in an isolated worktree from workspaceRoot. */
  useWorktree?: boolean
  schedule: ScheduledTaskScheduleV1
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: ScheduleTaskStatus
  lastMessage: string
  lastThreadId: string
}

export type ScheduleInternalSettingsV1 = {
  port: number
  secret: string
}

export type ScheduleSettingsV1 = {
  enabled: boolean
  defaultWorkspaceRoot: string
  /** Default model provider used when creating scheduled tasks. Empty means the current/default runtime provider. */
  providerId?: string
  model: string
  mode: ScheduleRunMode
  promptPrefix: string
  skills: ScheduleSkillSettingsV1
  keepAwake: boolean
  internal: ScheduleInternalSettingsV1
  tasks: ScheduledTaskV1[]
}

// ---------------------------------------------------------------------------
// Workflow (n8n-style node-based automation)
//
// A workflow is the multi-step generalization of a scheduled task: instead of a
// single prompt it is a graph of nodes connected by edges. The "ai-agent" node
// reuses the exact same Kun-runtime execution path as a scheduled task.
// ---------------------------------------------------------------------------

export type WorkflowNodeKind =
  | 'manual-trigger'
  | 'schedule-trigger'
  | 'webhook-trigger'
  | 'ai-agent'
  | 'generate-image'
  | 'condition'
  | 'switch'
  | 'filter'
  | 'set-fields'
  | 'code'
  | 'sort'
  | 'limit'
  | 'aggregate'
  | 'http-request'
  | 'merge'
  | 'subworkflow'
  | 'loop'
  | 'delay'
  | 'template'
  | 'json'
  | 'output'
  | 'parameter-extractor'
  | 'question-classifier'
  | 'human-approval'
  | 'custom'

export const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = [
  'manual-trigger',
  'schedule-trigger',
  'webhook-trigger',
  'ai-agent',
  'generate-image',
  'condition',
  'switch',
  'filter',
  'set-fields',
  'code',
  'sort',
  'limit',
  'aggregate',
  'http-request',
  'merge',
  'subworkflow',
  'loop',
  'delay',
  'template',
  'json',
  'output',
  'parameter-extractor',
  'question-classifier',
  'human-approval',
  'custom'
]

export type WorkflowRunStatus = 'idle' | 'running' | 'success' | 'error'
export type WorkflowNodeRunStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

/** Schedule trigger extends the scheduled-task schedule kinds with cron. */
export type WorkflowTriggerScheduleKind = ScheduleKind | 'cron'

export type WorkflowScheduleV1 = {
  kind: WorkflowTriggerScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
  /** Cron expression, used when kind === 'cron'. */
  cron: string
}

export type WorkflowConditionOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export type WorkflowHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const WORKFLOW_INPUT_FIELD_TYPES = ['text', 'paragraph', 'number', 'boolean', 'select', 'json'] as const
export type WorkflowInputFieldType = (typeof WORKFLOW_INPUT_FIELD_TYPES)[number]

/** Types offered for a node's typed inputs (subset of the field types — no select/paragraph). */
export const WORKFLOW_NODE_INPUT_TYPES = ['text', 'number', 'boolean', 'json'] as const
export type WorkflowNodeInputType = (typeof WORKFLOW_NODE_INPUT_TYPES)[number]

/**
 * A named, typed input a node pulls from an upstream node's output (dify-style).
 * `source` is an expression ({{$nodes.<id>.json.path}} / {{text}} / {{json.x}});
 * the resolved + coerced value is exposed to the node as {{$input.key}}.
 */
export type WorkflowNodeInputV1 = {
  key: string
  type: WorkflowNodeInputType
  source: string
}

/**
 * The value-type vocabulary the variable picker uses to badge a node's outputs.
 * A trimmed analogue of Dify's VarType — only what our nodes actually emit. NOT
 * persisted (never enters the settings schema); derived on the fly by
 * describeNodeOutput. `object` is drillable (has children); `json` is an opaque
 * blob the user dot-paths into manually; `any` is unknowable. Defer array[*]/file
 * until a node actually produces them.
 */
export const WORKFLOW_VAR_TYPES = ['string', 'number', 'boolean', 'object', 'json', 'any'] as const
export type WorkflowVarType = (typeof WORKFLOW_VAR_TYPES)[number]

/**
 * One advertised output field of a node, for the typed reference picker. `key` is
 * a dot-path relative to the node's json (or the literal 'text'). Derived metadata
 * only — see workflow-output-descriptors.ts. `children` cascades object types.
 */
export type WorkflowOutputVar = {
  key: string
  type: WorkflowVarType
  /** Present only for object types; lets the picker drill in. */
  children?: WorkflowOutputVar[]
  /** Optional human label for the picker row. */
  label?: string
}

/**
 * One typed input the caller supplies when starting a workflow. Drives the
 * "Run once" form, validates the /workflow/run + run_workflow input, and lifts
 * each value onto the run's initial payload.json by `key`.
 */
export type WorkflowInputFieldV1 = {
  key: string
  label: string
  type: WorkflowInputFieldType
  required: boolean
  /** Options for `select`. */
  options: string[]
  defaultValue: string
  description: string
}

/**
 * Triggers carry the run's working directory. When a workflow fires from this
 * trigger, `workspaceRoot` is the default cwd for AI / image / code nodes
 * (empty inherits settings.workflow.defaultWorkspaceRoot, then the app workspace).
 */
export type WorkflowManualTriggerConfigV1 = {
  workspaceRoot?: string
  /** Typed inputs the caller provides when starting the workflow. */
  inputSchema?: WorkflowInputFieldV1[]
}

export type WorkflowScheduleTriggerConfigV1 = {
  schedule: WorkflowScheduleV1
  workspaceRoot?: string
}

export type WorkflowWebhookMethod = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type WorkflowWebhookTriggerConfigV1 = {
  /** Path (leading slash) the local webhook listener matches, e.g. "/my-hook". */
  path: string
  method: WorkflowWebhookMethod
  workspaceRoot?: string
}

export type WorkflowAiAgentConfigV1 = {
  prompt: string
  workspaceRoot: string
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
}

export type WorkflowGenerateImageConfigV1 = {
  /** Image prompt; supports {{json.x}} / {{text}} interpolation. */
  prompt: string
  /** Provider profile (with an image capability) to use; empty falls back to the Settings image provider. */
  providerId: string
  /** Image model name; empty uses the provider/Settings default. */
  model: string
  /** Optional size override (e.g. "1024x1024"); empty uses the provider default. */
  size: string
  /**
   * Folder to save the image into. Empty = <workspace>/workflow-images.
   * Relative paths resolve against the workspace; absolute paths are used as-is.
   * Supports {{json.x}} / {{text}} interpolation.
   */
  outputDir: string
}

export type WorkflowConditionConfigV1 = {
  /** Accessor into the incoming payload, e.g. "text" or "json.value". Empty = previous node's text. */
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

/** One rule of a Switch node; matches feed the output handle `case-<index>`. */
export type WorkflowSwitchRuleV1 = {
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowSwitchConfigV1 = {
  rules: WorkflowSwitchRuleV1[]
  /** When true, expose a `fallback` output for inputs that match no rule. */
  fallback: boolean
}

/** Filter gate: passes the payload through only when the condition holds. */
export type WorkflowFilterConfigV1 = {
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowSortOrder = 'asc' | 'desc'
export type WorkflowSortConfigV1 = {
  /** Field path within each array item; empty sorts by the item itself. */
  field: string
  order: WorkflowSortOrder
  numeric: boolean
}

export type WorkflowLimitFrom = 'first' | 'last'
export type WorkflowLimitConfigV1 = {
  count: number
  from: WorkflowLimitFrom
}

export type WorkflowAggregateMode = 'count' | 'sum' | 'collect' | 'join'
export type WorkflowAggregateConfigV1 = {
  mode: WorkflowAggregateMode
  /** Field path within each array item (for sum/collect/join). */
  field: string
  /** Separator for 'join' mode. */
  separator: string
}

export type WorkflowMergeMode = 'array' | 'object'

export type WorkflowMergeConfigV1 = {
  /** 'array' collects upstream outputs into a list; 'object' shallow-merges object outputs. */
  mode: WorkflowMergeMode
}

export const WORKFLOW_CODE_LANGUAGES = ['javascript', 'python', 'bash'] as const
export type WorkflowCodeLanguage = (typeof WORKFLOW_CODE_LANGUAGES)[number]
export type WorkflowCodeConfigV1 = {
  /** Execution language. javascript runs sandboxed in-process; python/bash spawn a local interpreter. */
  language: WorkflowCodeLanguage
  /**
   * Script body.
   * - javascript: receives $json / $text and may `return` a value (sandboxed, short timeout).
   * - python / bash: input arrives on stdin as JSON and via $WORKFLOW_JSON / $WORKFLOW_TEXT;
   *   whatever the script prints to stdout becomes the output (parsed as JSON when possible).
   */
  code: string
}

export type WorkflowSubWorkflowConfigV1 = {
  /** id of another workflow to run; its output becomes this node's output. */
  workflowId: string
}

/** Renders the payload into a free-form text string (or JSON parsed from it). */
export type WorkflowTemplateConfigV1 = {
  /** Template with {{json.x}} / {{text}} interpolation. */
  template: string
  /** 'text' emits the rendered string; 'json' parses it as JSON (falls back to { text }). */
  outputMode: 'text' | 'json'
}

/** Converts between text and structured JSON. */
export type WorkflowJsonConfigV1 = {
  /** 'parse' turns the incoming text into JSON; 'stringify' serializes the incoming JSON to text. */
  mode: 'parse' | 'stringify'
  /** When parsing, throw on invalid JSON instead of falling back to { text }. */
  strict: boolean
}

/**
 * Terminal node that shapes the workflow's final output — what run_workflow,
 * the local /workflow/run endpoint, and the run viewer treat as the result.
 */
export type WorkflowOutputConfigV1 = {
  /** 'auto' passes the incoming payload through; 'text' renders a template; 'json' extracts a path. */
  mode: 'auto' | 'text' | 'json'
  /** Used in 'text' mode — supports {{json.x}} / {{text}}. */
  textTemplate: string
  /** Used in 'json' mode — dot path into the incoming json (empty = the whole json). */
  jsonPath: string
}

/** A node that runs a user-defined custom module, with the module's field values. */
export type WorkflowCustomConfigV1 = {
  /** id of the WorkflowCustomModuleV1 this node runs. */
  moduleId: string
  /** Field key -> value (stored as strings; coerced by the field's type at runtime). */
  values: Record<string, string>
}

/** dify-style Parameter Extractor: an LLM turns free text into typed JSON fields. */
export type WorkflowParameterExtractorConfigV1 = {
  /** Expression for the source text (default {{text}}). */
  source: string
  instruction: string
  /** Fields to extract (reuses the typed input-field schema). */
  fields: WorkflowInputFieldV1[]
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

export type WorkflowClassifierCategoryV1 = { id: string; label: string }

/** dify-style Question Classifier: an LLM routes the input to one of N categories. */
export type WorkflowQuestionClassifierConfigV1 = {
  /** Expression for the text to classify (default {{text}}). */
  source: string
  instruction: string
  categories: WorkflowClassifierCategoryV1[]
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

export type WorkflowApprovalDecision = 'approved' | 'rejected'

/** Human-in-the-loop pause: the run waits for an approve/reject decision before continuing. */
export type WorkflowHumanApprovalConfigV1 = {
  title: string
  instruction: string
  /** Auto-resolve after this many ms; 0 = wait indefinitely. */
  timeoutMs: number
  onTimeout: WorkflowApprovalDecision
}

export const WORKFLOW_MODULE_FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'select'] as const
export type WorkflowModuleFieldType = (typeof WORKFLOW_MODULE_FIELD_TYPES)[number]

/** One input on a custom module's auto-generated form. */
export type WorkflowModuleFieldV1 = {
  /** Identifier exposed to the script as $fields.<key> / WORKFLOW_FIELDS[<key>]. */
  key: string
  label: string
  type: WorkflowModuleFieldType
  /** Default value (string form); number/boolean are coerced from this. */
  defaultValue: string
  /** Options for `select` fields. */
  options: string[]
  placeholder: string
}

/**
 * A reusable, user-defined module = a script (JS/Python/Shell) plus a set of
 * named form fields. Instantiated on the canvas as a `custom` node, which shows
 * a form generated from `fields` and runs `code` with those values injected.
 */
export type WorkflowCustomModuleV1 = {
  id: string
  name: string
  description: string
  /** Reserved for a future icon picker; empty uses a generic module icon. */
  icon: string
  language: WorkflowCodeLanguage
  fields: WorkflowModuleFieldV1[]
  code: string
}

/**
 * Loop agent: repeatedly runs a body workflow, feeding each iteration's output
 * back in as the next input, until the stop condition holds or maxIterations is
 * reached. Turns "you press enter each step" into "you set the goal, the loop runs".
 */
export type WorkflowLoopMode = 'condition' | 'foreach'
export type WorkflowLoopExecution = 'sequential' | 'parallel'

export type WorkflowLoopConfigV1 = {
  /** id of the workflow run once per iteration. */
  workflowId: string
  /** 'condition' (while-loop, default) or 'foreach' (iterate an array). */
  mode?: WorkflowLoopMode
  /** foreach: expression resolving to the array to iterate (empty = the incoming payload json). */
  arraySource?: string
  /** foreach: run items one-at-a-time or concurrently. */
  execution?: WorkflowLoopExecution
  /** foreach: max concurrent iterations when execution = 'parallel' (1-8). */
  concurrency?: number
  /** foreach: collect failed items as { error } instead of aborting the loop. */
  continueOnError?: boolean
  /** Caps iterations (condition mode) and array length (foreach mode). */
  maxIterations: number
  /** Stop-when condition evaluated against each iteration's output (condition mode). */
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowHttpHeaderV1 = {
  key: string
  value: string
}

export type WorkflowHttpRequestConfigV1 = {
  method: WorkflowHttpMethod
  url: string
  headers: WorkflowHttpHeaderV1[]
  /** Templated with {{json.x}} / {{text}} from the incoming payload. */
  body: string
  timeoutMs: number
  /** Parse the response body as JSON into the payload for downstream nodes. */
  parseJson: boolean
}

export type WorkflowDelayConfigV1 = {
  delayMs: number
}

export type WorkflowFieldV1 = {
  key: string
  /** Templated with {{json.x}} / {{text}} from the incoming payload. */
  value: string
}

export type WorkflowSetFieldsConfigV1 = {
  fields: WorkflowFieldV1[]
  /** When true, merge the new fields onto the incoming json; otherwise replace it. */
  keepIncoming: boolean
  /** 'payload' (default) writes to the node output; 'run' writes into run-scoped vars ({{$run.key}}). */
  scope?: 'payload' | 'run'
}

export type WorkflowNodeConfigByKind = {
  'manual-trigger': WorkflowManualTriggerConfigV1
  'schedule-trigger': WorkflowScheduleTriggerConfigV1
  'webhook-trigger': WorkflowWebhookTriggerConfigV1
  'ai-agent': WorkflowAiAgentConfigV1
  'generate-image': WorkflowGenerateImageConfigV1
  condition: WorkflowConditionConfigV1
  switch: WorkflowSwitchConfigV1
  filter: WorkflowFilterConfigV1
  'set-fields': WorkflowSetFieldsConfigV1
  code: WorkflowCodeConfigV1
  sort: WorkflowSortConfigV1
  limit: WorkflowLimitConfigV1
  aggregate: WorkflowAggregateConfigV1
  'http-request': WorkflowHttpRequestConfigV1
  merge: WorkflowMergeConfigV1
  subworkflow: WorkflowSubWorkflowConfigV1
  loop: WorkflowLoopConfigV1
  delay: WorkflowDelayConfigV1
  template: WorkflowTemplateConfigV1
  json: WorkflowJsonConfigV1
  output: WorkflowOutputConfigV1
  'parameter-extractor': WorkflowParameterExtractorConfigV1
  'question-classifier': WorkflowQuestionClassifierConfigV1
  'human-approval': WorkflowHumanApprovalConfigV1
  custom: WorkflowCustomConfigV1
}

/** How a node behaves when its execution fails after retries. */
export type WorkflowNodeErrorMode = 'fail' | 'continue' | 'fallback'

/** Discriminated union over `type`, each kind carrying its own `config`. */
export type WorkflowNodeV1 = {
  [K in WorkflowNodeKind]: {
    id: string
    type: K
    /** Display label shown on the canvas. */
    name: string
    /** React Flow canvas coordinates. Opaque to the backend. */
    position: { x: number; y: number }
    disabled: boolean
    /** Error policy. Absent = 'fail' (the run stops) — preserves the original behavior. */
    onError?: WorkflowNodeErrorMode
    /** Retry attempts before applying onError (0 = no retry). */
    retries?: number
    retryDelayMs?: number
    /** For onError = 'fallback': JSON the node emits instead of failing. */
    fallbackJson?: string
    /** Named, typed inputs pulled from upstream output; resolved before the node runs as {{$input.key}}. */
    inputs?: WorkflowNodeInputV1[]
    config: WorkflowNodeConfigByKind[K]
  }
}[WorkflowNodeKind]

/** Flat edge array, binds directly to React Flow. Condition uses sourceHandle 'true' | 'false'. */
export type WorkflowConnectionV1 = {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export type WorkflowNodeRunResultV1 = {
  nodeId: string
  status: WorkflowNodeRunStatus
  startedAt: string
  finishedAt: string
  /** Assistant text / HTTP body / condition branch summary. */
  message: string
  /** JSON payload this node emitted, serialized. Empty when none. */
  outputJson: string
  /** JSON payload this node received, serialized. Empty when none. (For the run history viewer.) */
  inputJson?: string
  /** Retry attempts spent before this result (0/absent = first try). */
  retries?: number
  /** For ai-agent nodes: the Kun thread it created. */
  threadId: string
  error: string
}

/** Result of a single-node test run (not persisted to history). */
export type WorkflowNodeTestResult =
  | { ok: true; result: WorkflowNodeRunResultV1 }
  | { ok: false; message: string }

/** A human-approval node that has paused a run and is awaiting a decision. */
export type WorkflowPendingApprovalV1 = {
  token: string
  workflowId: string
  runId: string
  nodeId: string
  nodeName: string
  title: string
  instruction: string
  createdAt: string
}

export type WorkflowRunV1 = {
  id: string
  /** 'manual' | 'schedule' | trigger node id. */
  trigger: string
  status: WorkflowRunStatus
  startedAt: string
  finishedAt: string
  message: string
  nodeResults: WorkflowNodeRunResultV1[]
}

/** A workflow-scoped variable readable via {{$env.key}} in node expressions. */
export type WorkflowEnvVarV1 = {
  key: string
  value: string
  type: 'string' | 'number' | 'boolean' | 'secret'
}

export type WorkflowV1 = {
  id: string
  name: string
  enabled: boolean
  /** When true, the Kun agent may invoke this workflow as a tool (list_workflows / run_workflow). */
  callableByAgent: boolean
  /** Workflow-scoped variables, exposed to node expressions as {{$env.key}}. */
  env: WorkflowEnvVarV1[]
  nodes: WorkflowNodeV1[]
  connections: WorkflowConnectionV1[]
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: WorkflowRunStatus
  lastMessage: string
  /** Bounded history of recent runs (most recent last, capped). */
  runs: WorkflowRunV1[]
}

/**
 * A reusable palette item created by snapshotting a configured node. Dropping it
 * onto the canvas creates a fresh node of `nodeType` pre-filled with `config`.
 */
export type WorkflowNodePresetV1 = {
  id: string
  /** Palette label chosen by the user. */
  label: string
  /** Optional lucide icon name; empty falls back to the node kind's default icon. */
  icon: string
  /** Underlying built-in node kind this preset instantiates. */
  nodeType: WorkflowNodeKind
  /** Default name applied to the created node. */
  nodeName: string
  /** Saved config snapshot; shape matches `nodeType`. */
  config: WorkflowNodeV1['config']
}

/** The kun agent hook phases a workflow can be bound to. Mirrors kun's HOOK_PHASES. */
export const WORKFLOW_HOOK_PHASES = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'TurnStart',
  'TurnEnd',
  'PreCompact'
] as const
export type WorkflowHookPhase = (typeof WORKFLOW_HOOK_PHASES)[number]

/** How a bound workflow's output maps back to the hook result. */
export const WORKFLOW_HOOK_MODES = ['observe', 'block', 'rewrite'] as const
export type WorkflowHookMode = (typeof WORKFLOW_HOOK_MODES)[number]

/** Binds a Create Loop workflow to a kun agent hook phase (reactive automation). */
export type WorkflowHookTriggerV1 = {
  id: string
  enabled: boolean
  /** Workflow to run when the phase fires. */
  workflowId: string
  phase: WorkflowHookPhase
  /** Exact tool names to match (tool phases only); empty matches all tools. */
  toolNames: string[]
  /**
   * observe = run, change nothing; block = deny the action if the workflow fails/says DENY;
   * rewrite = fold the workflow output into the tool result / injected context.
   */
  mode: WorkflowHookMode
  /** Hook timeout in ms; 0 uses the kun default. */
  timeoutMs: number
}

export type WorkflowSettingsV1 = {
  enabled: boolean
  defaultWorkspaceRoot: string
  /** Default model provider for new AI nodes. Empty inherits the Kun runtime provider. */
  providerId?: string
  model: string
  mode: ScheduleRunMode
  keepAwake: boolean
  /** Local-only (127.0.0.1) port the webhook-trigger listener binds to. */
  webhookPort: number
  /** Optional shared secret required on inbound webhook requests (x-kun-secret / Bearer). */
  webhookSecret: string
  workflows: WorkflowV1[]
  /** Reusable palette items the user saved from configured nodes. */
  presets: WorkflowNodePresetV1[]
  /** User-defined script-backed modules. */
  modules: WorkflowCustomModuleV1[]
  /** Workflows bound to kun agent hook phases (reactive automation in code mode). */
  hookTriggers: WorkflowHookTriggerV1[]
}

export type WorkflowSettingsPatchV1 = Partial<Omit<WorkflowSettingsV1, 'workflows'>> & {
  /** Replaced wholesale when present. */
  workflows?: Array<Partial<WorkflowV1>>
}

export type WorkflowRunResult =
  | { ok: true; runId: string; status: WorkflowRunStatus; message: string }
  | { ok: false; message: string }

/** Result of an editor-time syntax check on a Code node's script. */
export type WorkflowCodeCheckResult =
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

export type WorkflowNodeStatusMap = Record<string, WorkflowNodeRunStatus>

export type WorkflowRuntimeStatus = {
  runningWorkflowIds: string[]
  /** workflowId -> nodeId -> live status, for lighting up the canvas during a run. */
  nodeStatus: Record<string, WorkflowNodeStatusMap>
  /** workflowId -> nodeId -> live per-node result (input/output/timing), for the run-log panel. */
  nodeResults: Record<string, Record<string, WorkflowNodeRunResultV1>>
  powerSaveBlockerActive: boolean
  /** Human-approval nodes currently paused, awaiting an approve/reject decision. */
  pendingApprovals: WorkflowPendingApprovalV1[]
}

export type ClawSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
  /**
   * Discovered skill roots the user turned off. Holds common-directory ids
   * (e.g. `global-codex`) and/or normalized absolute paths for custom dirs.
   */
  disabledDirs: string[]
  promptPrefix: string
}

export type ClawImSettingsV1 = {
  enabled: boolean
  provider: ClawImProvider
  port: number
  path: string
  secret: string
  weixinBridgeUrl: string
  workspaceRoot: string
  /** Default model provider for IM channels without their own provider. Empty inherits Kun runtime provider. */
  providerId?: string
  model: string
  mode: ClawRunMode
  responseTimeoutMs: number
}

export type ClawTaskScheduleV1 = {
  kind: ClawScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

export type ClawTaskV1 = ScheduledTaskV1

export type ClawImAgentProfileV1 = {
  name: string
  description: string
  identity: string
  personality: string
  userContext: string
  replyRules: string
}

export type ClawImFeishuPlatformCredentialV1 = {
  kind: 'feishu'
  appId: string
  appSecret: string
  domain: string
  createdAt: string
}

export type ClawImWeixinPlatformCredentialV1 = {
  kind: 'weixin'
  accountId: string
  sessionKey: string
  createdAt: string
}

export type ClawImTelegramPlatformCredentialV1 = {
  kind: 'telegram'
  botToken: string
  /**
   * Comma-separated Telegram chat ids allowed to talk to the bot.
   * Empty string means "allow all private chats" (group chats are always rejected).
   */
  allowedChatIds: string
  /** Bot username resolved via getMe, e.g. "my_kun_bot". Cosmetic only. */
  botUsername?: string
  createdAt: string
}

export type ClawImPlatformCredentialV1 =
  | ClawImFeishuPlatformCredentialV1
  | ClawImWeixinPlatformCredentialV1
  | ClawImTelegramPlatformCredentialV1

export type ClawImRemoteSessionV1 = {
  chatId: string
  messageId: string
  threadId: string
  senderId: string
  senderName: string
  updatedAt: string
}

export type ClawImConversationV1 = {
  id: string
  chatId: string
  remoteThreadId: string
  latestMessageId: string
  senderId: string
  senderName: string
  /** Kun thread id this conversation maps to. */
  localThreadId: string
  workspaceRoot: string
  createdAt: string
  updatedAt: string
}

export type ClawImChannelV1 = {
  id: string
  provider: ClawImProvider
  label: string
  enabled: boolean
  /** Enable SSE-driven Feishu / Lark reply streaming instead of one-shot polling replies. */
  feishuStream?: boolean
  /** Model provider used by this IM channel. Empty inherits the IM/global provider. */
  providerId?: string
  model: string
  /** Kun thread id this channel maps to. */
  threadId: string
  workspaceRoot: string
  agentProfile: ClawImAgentProfileV1
  platformCredential?: ClawImPlatformCredentialV1
  remoteSession?: ClawImRemoteSessionV1
  conversations: ClawImConversationV1[]
  /** When the one-time IM welcome/intro message was delivered. */
  welcomeSentAt?: string
  createdAt: string
  updatedAt: string
}

export type ClawSettingsV1 = {
  enabled: boolean
  skills: ClawSkillSettingsV1
  im: ClawImSettingsV1
  channels: ClawImChannelV1[]
  tasks: ClawTaskV1[]
}

export type WriteInlineCompletionSettingsV1 = {
  enabled: boolean
  retrievalEnabled: boolean
  longCompletionEnabled: boolean
  /** When true, Write inherits Kun's selected provider instead of using `providerId`. */
  inheritProvider: boolean
  /** Selected provider for Write inline completion when `inheritProvider` is false. */
  providerId: string
  apiKey: string
  baseUrl: string
  /** When true, Write inherits Kun's runtime model instead of using `model` as an override. */
  inheritModel: boolean
  model: string
  debounceMs: number
  longDebounceMs: number
  minAcceptScore: number
  longMinAcceptScore: number
  maxTokens: number
  longMaxTokens: number
}

/** 'edit' rewrites the selection in place; 'chat' hands it to the sidebar assistant. */
export type WriteQuickActionMode = 'edit' | 'chat'

export type WriteQuickActionV1 = {
  /** Stable identifier; built-in ids ('polish' | 'explain' | 'reformat') get localized fallbacks. */
  id: string
  /** Display label shown in the selection toolbar; empty = localized default for built-in ids. */
  label: string
  /** Prompt used for the edit/chat; empty = localized default for built-in ids. */
  prompt: string
  /** Whether the result rewrites the selection in place ('edit') or goes to the sidebar ('chat'). */
  mode: WriteQuickActionMode
}

export type WriteSelectionAssistSettingsV1 = {
  /** Custom infographic generation prompt prefix; empty = built-in default. */
  infographicPrompt: string
  /** Custom UI design mockup prompt prefix; empty = built-in default. */
  designDraftPrompt: string
  /** Custom interactive HTML prototype prompt; empty = built-in default. */
  prototypePrompt: string
  quickActions: WriteQuickActionV1[]
}

export type WriteFontPreset =
  | 'system'
  | 'sourceHanSans'
  | 'yahei'
  | 'pingfang'
  | 'simhei'
  | 'simsun'
  | 'kaiti'
  | 'custom'

export const WRITE_FONT_PRESETS: readonly WriteFontPreset[] = [
  'system',
  'sourceHanSans',
  'yahei',
  'pingfang',
  'simhei',
  'simsun',
  'kaiti',
  'custom'
] as const

export const WRITE_EDITOR_FONT_SIZE_MIN = 10
export const WRITE_EDITOR_FONT_SIZE_MAX = 48
export const DEFAULT_WRITE_EDITOR_FONT_SIZE_PX = 16
export const WRITE_EDITOR_LINE_HEIGHT_MIN = 1.4
export const WRITE_EDITOR_LINE_HEIGHT_MAX = 2.2
export const DEFAULT_WRITE_EDITOR_LINE_HEIGHT = 1.75

/**
 * Typography for the Write editor prose surfaces (rich editor, CodeMirror live
 * appearance, and the markdown preview). The raw source appearance keeps its
 * monospace family but still honors the configured size.
 */
export type WriteTypographySettingsV1 = {
  /** Named font preset; 'custom' uses `customFontFamily`. */
  fontPreset: WriteFontPreset
  /** CSS font-family stack used when `fontPreset === 'custom'`. */
  customFontFamily: string
  /** Base font size in px, clamped to [WRITE_EDITOR_FONT_SIZE_MIN, WRITE_EDITOR_FONT_SIZE_MAX]. */
  fontSizePx: number
  /** Unitless line-height, clamped to [WRITE_EDITOR_LINE_HEIGHT_MIN, WRITE_EDITOR_LINE_HEIGHT_MAX]. */
  lineHeight: number
}

export const WRITE_AGENT_PRESET_MAX_COUNT = 12
export const WRITE_AGENT_PRESET_NAME_MAX_CHARS = 40
export const WRITE_AGENT_PERSONA_MAX_CHARS = 4000

/**
 * A named, reusable writing-assistant persona (plot coordinator, line editor,
 * foreshadowing tracker, continuity checker…). The persona text frames the
 * assistant for a specific creative role and can be switched per conversation.
 */
export type WriteAgentPresetV1 = {
  /** Stable id; built-in ids ('coordinator' | 'editor' | 'foreshadowing' | 'continuity') get localized name/persona fallbacks. */
  id: string
  /** Display name; empty = localized default for built-in ids. */
  name: string
  /** Short emoji/glyph badge shown in the switcher. */
  emoji: string
  /** Persona + behavior rules used to frame the assistant. Empty = localized default for built-in ids. */
  persona: string
}

export type WriteSettingsV1 = {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
  selectionAssist: WriteSelectionAssistSettingsV1
  typography: WriteTypographySettingsV1
  agentPresets: WriteAgentPresetV1[]
}

export type ClawSettingsPatchV1 = Partial<Omit<ClawSettingsV1, 'skills' | 'im' | 'channels' | 'tasks'>> & {
  skills?: Partial<ClawSkillSettingsV1>
  im?: Partial<ClawImSettingsV1>
  channels?: Array<Partial<ClawImChannelV1>>
  tasks?: Array<Partial<ClawTaskV1>>
}

export type ScheduleSettingsPatchV1 = Partial<
  Omit<ScheduleSettingsV1, 'skills' | 'internal' | 'tasks'>
> & {
  skills?: Partial<ScheduleSkillSettingsV1>
  internal?: Partial<ScheduleInternalSettingsV1>
  tasks?: Array<Partial<ScheduledTaskV1>>
}

export type WriteSettingsPatchV1 = Partial<Omit<WriteSettingsV1, 'inlineCompletion' | 'selectionAssist' | 'typography' | 'agentPresets'>> & {
  inlineCompletion?: Partial<WriteInlineCompletionSettingsV1>
  selectionAssist?: Partial<Omit<WriteSelectionAssistSettingsV1, 'quickActions'>> & {
    /** Replaced wholesale when present. */
    quickActions?: Array<Partial<WriteQuickActionV1>>
  }
  typography?: Partial<WriteTypographySettingsV1>
  /** Replaced wholesale when present. */
  agentPresets?: Array<Partial<WriteAgentPresetV1>>
}

export type ClawGeneratedFileV1 = {
  path: string
  relativePath?: string
  fileName: string
}

export type ClawRunResult =
  | {
      ok: true
      threadId: string
      turnId?: string
      text?: string
      message?: string
      files?: ClawGeneratedFileV1[]
      /**
       * Whether the watched turn finished within the response window.
       * `false` means it outran the IM timeout and is still running —
       * the caller should ack now and push the result when it finishes.
       * Absent on the fire-and-forget (no `waitForResult`) path.
       */
      completed?: boolean
      /** The task was accepted by the background queue but has not started. */
      queued?: boolean
    }
  | { ok: false; message: string }

export type ScheduleRunResult = ClawRunResult

export type ScheduleTaskFromTextResult =
  | { kind: 'noop' }
  | { kind: 'created'; taskId: string; title: string; scheduleAt: string; confirmationText: string }
  | { kind: 'error'; message: string }

export type ClawTaskFromTextResult = ScheduleTaskFromTextResult

export type ClawRuntimeStatus = {
  imServerRunning: boolean
  imUrl: string
  runningTaskIds: string[]
}

export type ScheduleRuntimeStatus = {
  internalServerRunning: boolean
  internalUrl: string
  runningTaskIds: string[]
  queuedTaskIds: string[]
  powerSaveBlockerActive: boolean
}

export type GuiUpdateConfigV1 = {
  channel: GuiUpdateChannel
}

export type TerminalColorMode = 'native' | 'none' | 'custom'

export type TerminalColorSettingsV1 = {
  /** 'native' = built-in app theme colors; 'none' = monochrome; 'custom' = use user-defined colors. */
  colorMode: TerminalColorMode
  foreground: string
  background: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type TerminalSettingsV1 = {
  colors: TerminalColorSettingsV1
}

export type TerminalSettingsPatchV1 = {
  colors?: Partial<TerminalColorSettingsV1>
}

export type AppSettingsV1 = {
  version: 1
  locale: 'en' | 'zh'
  theme: 'system' | 'light' | 'dark'
  uiFontScale: UiFontScale
  chatContentMaxWidthPx: ChatContentMaxWidthPx
  cursorSpotlight?: boolean
  cursorSpotlightColor?: string
  provider: ModelProviderSettingsV1
  agents: KunSettingsEnvelopeV1
  workspaceRoot: string
  /** 对话会话的工作目录根(默认 ~/Documents/Kun),不绑定项目文件夹。 */
  conversationWorkspaceRoot: string
  log: LogConfigV1
  checkpointCleanup: CheckpointCleanupConfigV1
  notifications: NotificationConfigV1
  appBehavior: AppBehaviorConfigV1
  keyboardShortcuts: KeyboardShortcutsConfigV1
  write: WriteSettingsV1
  claw: ClawSettingsV1
  schedule: ScheduleSettingsV1
  workflow: WorkflowSettingsV1
  guiUpdate: GuiUpdateConfigV1
  terminal: TerminalSettingsV1
  codePromptPrefix: string
  /** User-disabled skill IDs. Disabled skills are hidden from command surfaces. */
  disabledSkillIds: string[]
}

export type AppSettingsPatch = Partial<
  Omit<AppSettingsV1, 'provider' | 'agents' | 'log' | 'checkpointCleanup' | 'notifications' | 'appBehavior' | 'keyboardShortcuts' | 'write' | 'claw' | 'schedule' | 'workflow' | 'guiUpdate' | 'terminal'>
> & {
  provider?: ModelProviderSettingsPatchV1
  agents?: KunSettingsEnvelopePatchV1
  log?: Partial<LogConfigV1>
  checkpointCleanup?: Partial<CheckpointCleanupConfigV1>
  notifications?: Partial<NotificationConfigV1>
  appBehavior?: Partial<AppBehaviorConfigV1>
  keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
  write?: WriteSettingsPatchV1
  claw?: ClawSettingsPatchV1
  schedule?: ScheduleSettingsPatchV1
  workflow?: WorkflowSettingsPatchV1
  guiUpdate?: Partial<GuiUpdateConfigV1>
  terminal?: TerminalSettingsPatchV1
}
