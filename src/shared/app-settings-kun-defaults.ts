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
  MODEL_REQUEST_RETRY_DEFAULTS_VERSION,
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
  defaultKunFastContextSettings,
  defaultKunLabSettings,
  mergeKunRuntimeSettings
} from './app-settings-kun-merge'
import {
  migrateKunRuntimeTuningDefaults
} from './app-settings-kun-tuning'

export {
  defaultKunGraphSettings,
  normalizeKunGraphSettings
} from './app-settings-graph'

export const LEGACY_COREAGENT_DATA_DIR = '~/.deepseekgui/coreagent'

export const LEGACY_KUN_DEFAULT_MODEL = 'deepseek-chat'

export const LEGACY_KUN_STREAM_IDLE_TIMEOUT_MS = 45_000

// 旧版真实落盘默认值, 用于把升级前配置迁移到当前 Kun 默认端口。
export const LEGACY_LOCAL_HTTP_DEFAULT_PORT = 7878

export const PREVIOUS_KUN_DEFAULT_PORT = 8899

export type LegacyLocalHttpRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  apiKey: string
  baseUrl: string
  runtimeToken: string
  extraCorsOrigins: string[]
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer: ApprovalReviewer
}

export type LegacyReasoningEffort = 'low' | 'medium' | 'high' | 'max'

export type LegacyReasoningEditMode = 'review' | 'auto' | 'yolo' | 'plan'

export type LegacyReasoningRuntimeSettingsV1 = {
  binaryPath: string
  autoStart: boolean
  apiKey: string
  baseUrl: string
  model: string
  reasoningEffort: LegacyReasoningEffort
  editMode: LegacyReasoningEditMode
}

/**
 * Kun runtime settings. Mirrors the `kun serve` CLI
 * options. It is the only active agent settings object the GUI
 * stores after legacy settings have been migrated.
 */
export function legacyLocalHttpRuntimeDefaults(port = LEGACY_LOCAL_HTTP_DEFAULT_PORT): LegacyLocalHttpRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    runtimeToken: '',
    extraCorsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    approvalReviewer: DEFAULT_APPROVAL_REVIEWER
  }
}

export function legacyReasoningRuntimeDefaults(): LegacyReasoningRuntimeSettingsV1 {
  return {
    binaryPath: '',
    autoStart: true,
    apiKey: '',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    model: LEGACY_KUN_DEFAULT_MODEL,
    reasoningEffort: 'medium',
    editMode: 'auto'
  }
}

export function defaultKunRuntimeSettings(
  port = DEFAULT_KUN_PORT
): KunRuntimeSettingsV1 {
  return {
    binaryPath: '',
    port,
    autoStart: true,
    apiKey: '',
    baseUrl: '',
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    retry: {
      maxAttempts: DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
      initialDelayMs: DEFAULT_MODEL_REQUEST_RETRY_INITIAL_DELAY_MS,
      httpStatusCodes: [...DEFAULT_MODEL_REQUEST_RETRY_HTTP_STATUS_CODES],
      defaultsVersion: MODEL_REQUEST_RETRY_DEFAULTS_VERSION
    },
    runtimeToken: '',
    dataDir: DEFAULT_KUN_DATA_DIR,
    model: DEFAULT_KUN_MODEL,
    ...kunToolPermissionModeSettings('full-access'),
    tokenEconomyMode: false,
    tokenEconomy: defaultKunTokenEconomySettings(),
    toolOutputLimits: defaultKunToolOutputLimitsSettings(),
    insecure: false,
    mcpSearch: defaultKunMcpSearchSettings(),
    projectConfig: defaultKunProjectConfigSettings(),
    storage: defaultKunStorageSettings(),
    contextCompaction: defaultKunContextCompactionSettings(),
    runtimeTuning: defaultKunRuntimeTuningSettings(),
    llmDebug: defaultKunLlmDebugSettings(),
    imageGeneration: defaultKunImageGenerationSettings(),
    speechToText: defaultKunSpeechToTextSettings(),
    textToSpeech: defaultKunTextToSpeechSettings(),
    promptOptimization: defaultKunPromptOptimizationSettings(),
    musicGeneration: defaultKunMusicGenerationSettings(),
    videoGeneration: defaultKunVideoGenerationSettings(),
    modelProfiles: {},
    memoryEnabled: false,
    instructions: defaultKunInstructionSettings(),
    computerUse: defaultKunComputerUseSettings(),
    browserUse: defaultKunBrowserUseSettings(),
    quality: defaultKunQualitySettings(),
    graph: defaultKunGraphSettings(),
    planExecution: { useWorktreeByDefault: true },
    fastContext: defaultKunFastContextSettings(),
    lab: defaultKunLabSettings()
  }
}

/**
 * Compatibility-only base for normalizing already persisted settings. Keep
 * this separate from the fresh-profile default so an older partial record can
 * never acquire Full access merely because a new field was absent.
 */
export function legacyKunRuntimeSettingsDefaults(
  port = DEFAULT_KUN_PORT
): KunRuntimeSettingsV1 {
  return {
    ...defaultKunRuntimeSettings(port),
    approvalPolicy: DEFAULT_APPROVAL_POLICY,
    sandboxMode: DEFAULT_SANDBOX_MODE,
    approvalReviewer: DEFAULT_APPROVAL_REVIEWER
  }
}

export function normalizeApprovalReviewer(value: unknown): ApprovalReviewer {
  return value === 'agent' ? 'agent' : DEFAULT_APPROVAL_REVIEWER
}

export function defaultKunInstructionSettings(): KunInstructionSettingsV1 {
  return {
    enabled: true
  }
}

export function defaultKunLlmDebugSettings(): KunLlmDebugSettingsV1 {
  return {
    defaultThreadCaptureEnabled: false
  }
}

export function defaultKunToolOutputLimitsSettings(): KunToolOutputLimitsSettingsV1 {
  return {
    maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
    maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
  }
}

export function defaultKunQualitySettings(): KunDesignQualitySettingsV1 {
  return {
    enabled: true,
    strictness: 'standard',
    ignoreRules: [],
    ignoreFiles: [],
    maxFindings: 12
  }
}

export function defaultKunComputerUseSettings(): KunComputerUseSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
}

export function defaultKunBrowserUseSettings(): KunBrowserUseSettingsV1 {
  return {
    enabled: true,
    mode: 'public',
    approvalMode: 'auto-safe',
    maxTabs: 2,
    maxObservationActionsPerTurn: 30,
    maxInteractionActionsPerTurn: 12,
    maxSnapshotNodes: 250,
    maxSnapshotTextChars: 20_000,
    maxImageDimension: 1280,
    idleTimeoutMs: 5 * 60_000
  }
}

export function defaultKunImageGenerationSettings(): KunImageGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultResolution: DEFAULT_IMAGE_GENERATION_RESOLUTION,
    defaultSize: '',
    quality: 'auto',
    timeoutMs: 180_000
  }
}

export function defaultKunSpeechToTextSettings(): KunSpeechToTextSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    localWhisperDownloadSource: LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
    language: '',
    timeoutMs: 60_000
  }
}

export function defaultKunTextToSpeechSettings(): KunTextToSpeechSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    voice: '',
    format: 'mp3',
    timeoutMs: 120_000
  }
}

export function defaultKunPromptOptimizationSettings(): KunPromptOptimizationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    model: '',
    prompt: '',
    timeoutMs: 60_000
  }
}

export function defaultKunMusicGenerationSettings(): KunMusicGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    format: 'mp3',
    timeoutMs: 300_000
  }
}

export function defaultKunVideoGenerationSettings(): KunVideoGenerationSettingsV1 {
  return {
    enabled: false,
    providerId: '',
    protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
    baseUrl: '',
    apiKey: '',
    model: '',
    defaultDuration: 6,
    defaultResolution: '1080P',
    timeoutMs: 900_000,
    pollIntervalMs: 10_000
  }
}

export function defaultKunMcpSearchSettings(): KunMcpSearchSettingsV1 {
  return {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
}

export function defaultKunProjectConfigSettings(): KunProjectConfigSettingsV1 {
  return { grants: [] }
}

export function defaultKunTokenEconomySettings(): KunTokenEconomySettingsV1 {
  return {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: defaultKunHistoryHygieneSettings()
  }
}

export function defaultKunHistoryHygieneSettings(): KunHistoryHygieneSettingsV1 {
  return {
    maxToolResultLines: 320,
    maxToolResultBytes: 32 * 1024,
    maxToolResultTokens: 8_000,
    maxToolArgumentStringBytes: 8 * 1024,
    maxToolArgumentStringTokens: 2_000,
    maxArrayItems: 80
  }
}

export function defaultKunStorageSettings(): KunStorageSettingsV1 {
  return {
    backend: 'hybrid',
    sqlitePath: ''
  }
}

export const KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION = 2

export const KUN_RUNTIME_TUNING_DEFAULTS_VERSION = 1

export const DEFAULT_KUN_STREAM_IDLE_TIMEOUT_MS = 450_000

export const LEGACY_KUN_CONTEXT_COMPACTION_DEFAULTS = [
  { soft: 16_000, hard: 24_000 },
  { soft: 96_000, hard: 108_800 }
] as const

export function defaultKunContextCompactionSettings(): KunContextCompactionSettingsV1 {
  return {
    defaultsVersion: KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
    defaultSoftThreshold: 192_000,
    defaultHardThreshold: 217_600,
    // Default to model-generated summaries (codex-style): the model writes a
    // structured recap of the folded turns instead of a mechanical item list.
    // Falls back to the heuristic summary automatically on timeout/failure.
    summaryMode: 'model',
    summaryTimeoutMs: 15_000,
    summaryMaxTokens: 2_048,
    summaryInputMaxBytes: 96 * 1024
  }
}

export function defaultKunRuntimeTuningSettings(): KunRuntimeTuningSettingsV1 {
  return {
    defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
    maxConcurrentTurns: 256,
    maxWallTimeMs: 86_400_000,
    streamIdleTimeoutMs: DEFAULT_KUN_STREAM_IDLE_TIMEOUT_MS,
    toolStorm: {
      enabled: true
    },
    toolArgumentRepair: {
      maxStringBytes: 512 * 1024
    },
    interruptedTurnResume: {
      enabled: true
    }
  }
}

export function getKunRuntimeSettings(
  settings: AppSettingsV1
): KunRuntimeSettingsV1 {
  const raw = (settings as { agents?: { kun?: Partial<KunRuntimeSettingsV1> } }).agents?.kun
  return mergeKunRuntimeSettings(
    raw ? legacyKunRuntimeSettingsDefaults() : defaultKunRuntimeSettings(),
    raw
      ? {
          ...raw,
          runtimeTuning: migrateKunRuntimeTuningDefaults(raw.runtimeTuning)
        }
      : raw
  )
}

export function kunSettingsEnvelope(
  kun: KunRuntimeSettingsV1
): KunSettingsEnvelopeV1 {
  return { kun }
}

export function kunSettingsPatch(
  kun: KunRuntimeSettingsPatchV1 | undefined
): KunSettingsEnvelopePatchV1 {
  return kun ? { kun } : {}
}
