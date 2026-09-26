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
  DEFAULT_KUN_STREAM_IDLE_TIMEOUT_MS,
  KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
  KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
  LEGACY_KUN_CONTEXT_COMPACTION_DEFAULTS,
  LEGACY_KUN_STREAM_IDLE_TIMEOUT_MS,
  defaultKunContextCompactionSettings,
  defaultKunHistoryHygieneSettings,
  defaultKunMcpSearchSettings,
  defaultKunRuntimeTuningSettings,
  defaultKunStorageSettings,
  defaultKunToolOutputLimitsSettings
} from './app-settings-kun-defaults'

export function normalizeKunTokenEconomySettings(
  input: Partial<KunTokenEconomySettingsV1> | undefined,
  enabledFallback = false
): KunTokenEconomySettingsV1 {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : enabledFallback,
    compressToolDescriptions: input?.compressToolDescriptions !== false,
    compressToolResults: input?.compressToolResults !== false,
    conciseResponses: input?.conciseResponses !== false,
    historyHygiene: normalizeKunHistoryHygieneSettings(input?.historyHygiene)
  }
}

export function normalizeKunToolOutputLimitsSettings(
  input: Partial<KunToolOutputLimitsSettingsV1> | undefined
): KunToolOutputLimitsSettingsV1 {
  const defaults = defaultKunToolOutputLimitsSettings()
  return {
    maxLines: boundedPositiveInt(input?.maxLines, defaults.maxLines, 1_000_000),
    maxBytes: boundedPositiveInt(input?.maxBytes, defaults.maxBytes, 64 * 1024 * 1024)
  }
}

export function normalizeKunHistoryHygieneSettings(
  input: Partial<KunHistoryHygieneSettingsV1> | undefined
): KunHistoryHygieneSettingsV1 {
  const defaults = defaultKunHistoryHygieneSettings()
  return {
    maxToolResultLines: boundedPositiveInt(input?.maxToolResultLines, defaults.maxToolResultLines, 100_000),
    maxToolResultBytes: boundedPositiveInt(input?.maxToolResultBytes, defaults.maxToolResultBytes, 8 * 1024 * 1024),
    maxToolResultTokens: boundedPositiveInt(input?.maxToolResultTokens, defaults.maxToolResultTokens, 256_000),
    maxToolArgumentStringBytes: boundedPositiveInt(
      input?.maxToolArgumentStringBytes,
      defaults.maxToolArgumentStringBytes,
      8 * 1024 * 1024
    ),
    maxToolArgumentStringTokens: boundedPositiveInt(
      input?.maxToolArgumentStringTokens,
      defaults.maxToolArgumentStringTokens,
      64_000
    ),
    maxArrayItems: boundedPositiveInt(input?.maxArrayItems, defaults.maxArrayItems, 10_000)
  }
}

export function normalizeKunMcpSearchSettings(
  input: Partial<KunMcpSearchSettingsV1> | undefined
): KunMcpSearchSettingsV1 {
  const defaults = defaultKunMcpSearchSettings()
  const topKMax = positiveInt(input?.topKMax, defaults.topKMax)
  const topKDefault = Math.min(positiveInt(input?.topKDefault, defaults.topKDefault), topKMax)
  return {
    enabled: input?.enabled === true,
    mode: input?.mode === 'direct' || input?.mode === 'search' || input?.mode === 'auto'
      ? input.mode
      : defaults.mode,
    autoThresholdToolCount: positiveInt(input?.autoThresholdToolCount, defaults.autoThresholdToolCount),
    topKDefault,
    topKMax,
    minScore: nonNegativeNumber(input?.minScore, defaults.minScore)
  }
}

export function normalizeKunProjectConfigSettings(
  input: Partial<KunProjectConfigSettingsV1> | undefined
): KunProjectConfigSettingsV1 {
  const grants = Array.isArray(input?.grants) ? input.grants : []
  const unique = new Map<string, { workspaceRoot: string; configDigest: string }>()
  for (const grant of grants.slice(0, 64)) {
    const workspaceRoot = typeof grant?.workspaceRoot === 'string' ? grant.workspaceRoot.trim() : ''
    const configDigest = typeof grant?.configDigest === 'string'
      ? grant.configDigest.trim().toLowerCase()
      : ''
    if (!workspaceRoot || !/^[a-f0-9]{64}$/.test(configDigest)) continue
    unique.set(workspaceRoot, { workspaceRoot, configDigest })
  }
  return { grants: [...unique.values()] }
}

export function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

export function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

export function boundedPositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

/** Like {@link boundedPositiveInt} but accepts `0` (e.g. "disabled"). */
export function boundedNonNegativeInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return Math.min(Math.floor(value), max)
}

export function boundedRatio(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback
}

export function normalizeKunStorageSettings(
  input: Partial<KunStorageSettingsV1> | undefined
): KunStorageSettingsV1 {
  const defaults = defaultKunStorageSettings()
  return {
    backend: input?.backend === 'file' || input?.backend === 'hybrid'
      ? input.backend
      : defaults.backend,
    sqlitePath: typeof input?.sqlitePath === 'string' ? input.sqlitePath.trim() : defaults.sqlitePath
  }
}

export function normalizeKunContextCompactionSettings(
  input: Partial<KunContextCompactionSettingsV1> | undefined
): KunContextCompactionSettingsV1 {
  const defaults = defaultKunContextCompactionSettings()
  const upgraded = migrateKunContextCompactionDefaults(input)
  const defaultSoftThreshold = boundedPositiveInt(upgraded.defaultSoftThreshold, defaults.defaultSoftThreshold)
  const defaultHardThreshold = upgraded.defaultSoftThreshold !== undefined && upgraded.defaultHardThreshold === undefined
    ? defaultSoftThreshold
    : defaults.defaultHardThreshold
  const requestedHardThreshold = boundedPositiveInt(upgraded.defaultHardThreshold, defaultHardThreshold)
  return {
    defaultsVersion: KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
    defaultSoftThreshold,
    defaultHardThreshold: Math.max(defaultSoftThreshold, requestedHardThreshold),
    // Compaction is always model-based now (the heuristic fold survives only as
    // a silent in-loop fallback when the model call fails). 'heuristic' is no
    // longer a user-selectable mode, so any stored value coerces to 'model' —
    // this self-heals stale 'heuristic' configs from the removed UI toggle.
    summaryMode: 'model',
    windowModeEnabled: upgraded.windowModeEnabled === true,
    summaryTimeoutMs: boundedPositiveInt(upgraded.summaryTimeoutMs, defaults.summaryTimeoutMs, 120_000),
    summaryMaxTokens: boundedPositiveInt(upgraded.summaryMaxTokens, defaults.summaryMaxTokens, 16_000),
    summaryInputMaxBytes: boundedPositiveInt(upgraded.summaryInputMaxBytes, defaults.summaryInputMaxBytes, 8 * 1024 * 1024),
    ...(typeof upgraded.summaryModel === 'string' && upgraded.summaryModel.trim() ? { summaryModel: upgraded.summaryModel.trim() } : {}),
    ...(typeof upgraded.summaryProviderId === 'string' && upgraded.summaryProviderId.trim() ? { summaryProviderId: upgraded.summaryProviderId.trim() } : {})
  }
}

export function migrateKunContextCompactionDefaults(
  input: KunContextCompactionSettingsV1
): KunContextCompactionSettingsV1

export function migrateKunContextCompactionDefaults(
  input: Partial<KunContextCompactionSettingsV1> | undefined
): Partial<KunContextCompactionSettingsV1>

export function migrateKunContextCompactionDefaults(
  input: Partial<KunContextCompactionSettingsV1> | undefined
): Partial<KunContextCompactionSettingsV1> {
  const current = input ?? {}
  const defaultsVersion = boundedPositiveInt(current.defaultsVersion, 0)
  if (defaultsVersion >= KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION) return current

  const matchesLegacyDefaults = LEGACY_KUN_CONTEXT_COMPACTION_DEFAULTS.some(
    ({ soft, hard }) =>
      current.defaultSoftThreshold === soft &&
      current.defaultHardThreshold === hard
  )
  const defaults = defaultKunContextCompactionSettings()
  return {
    ...current,
    defaultsVersion: KUN_CONTEXT_COMPACTION_DEFAULTS_VERSION,
    ...(matchesLegacyDefaults
      ? {
          defaultSoftThreshold: defaults.defaultSoftThreshold,
          defaultHardThreshold: defaults.defaultHardThreshold
        }
      : {})
  }
}

export function normalizeKunRuntimeTuningSettings(
  input: Partial<KunRuntimeTuningSettingsV1> | undefined
): KunRuntimeTuningSettingsV1 {
  const defaults = defaultKunRuntimeTuningSettings()
  const migrated = migrateKunRuntimeTuningDefaults(input)
  return {
    defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
    maxConcurrentTurns: boundedPositiveInt(
      migrated.maxConcurrentTurns,
      defaults.maxConcurrentTurns,
      256
    ),
    maxWallTimeMs: boundedPositiveInt(
      migrated.maxWallTimeMs,
      defaults.maxWallTimeMs,
      86_400_000
    ),
    streamIdleTimeoutMs: boundedNonNegativeInt(
      migrated.streamIdleTimeoutMs,
      defaults.streamIdleTimeoutMs,
      3_600_000
    ),
    toolStorm: {
      enabled: migrated.toolStorm?.enabled !== false
    },
    toolArgumentRepair: {
      maxStringBytes: boundedPositiveInt(
        migrated.toolArgumentRepair?.maxStringBytes,
        defaults.toolArgumentRepair.maxStringBytes,
        16 * 1024 * 1024
      )
    },
    interruptedTurnResume: {
      enabled: migrated.interruptedTurnResume?.enabled !== false
    }
  }
}

export function normalizeKunLlmDebugSettings(
  input: Partial<KunLlmDebugSettingsV1> | undefined
): KunLlmDebugSettingsV1 {
  return {
    defaultThreadCaptureEnabled: input?.defaultThreadCaptureEnabled === true
  }
}

export function kunRuntimeTuningDefaultsMigrationNeeded(
  input: Partial<KunRuntimeTuningSettingsV1> | undefined
): boolean {
  return boundedPositiveInt(input?.defaultsVersion, 0) < KUN_RUNTIME_TUNING_DEFAULTS_VERSION
}

export function migrateKunRuntimeTuningDefaults(
  input: Partial<KunRuntimeTuningSettingsV1> | undefined
): Partial<KunRuntimeTuningSettingsV1> {
  const current = input ?? {}
  if (!kunRuntimeTuningDefaultsMigrationNeeded(current)) return current
  return {
    ...current,
    defaultsVersion: KUN_RUNTIME_TUNING_DEFAULTS_VERSION,
    ...(current.streamIdleTimeoutMs === LEGACY_KUN_STREAM_IDLE_TIMEOUT_MS
      ? { streamIdleTimeoutMs: DEFAULT_KUN_STREAM_IDLE_TIMEOUT_MS }
      : {})
  }
}
