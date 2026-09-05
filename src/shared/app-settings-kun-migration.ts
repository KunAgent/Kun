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
  type LegacyKunSubagentsSettingsInputV1,
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
import { normalizeGitHubMcpSettings } from './github-mcp-authorization'

import {
  LEGACY_COREAGENT_DATA_DIR,
  LEGACY_KUN_DEFAULT_MODEL,
  LEGACY_LOCAL_HTTP_DEFAULT_PORT,
  LegacyLocalHttpRuntimeSettingsV1,
  LegacyReasoningRuntimeSettingsV1,
  PREVIOUS_KUN_DEFAULT_PORT,
  defaultKunQualitySettings,
  getKunRuntimeSettings,
  kunSettingsEnvelope,
  legacyKunRuntimeSettingsDefaults,
  legacyLocalHttpRuntimeDefaults,
  legacyReasoningRuntimeDefaults,
  normalizeApprovalReviewer
} from './app-settings-kun-defaults'
import {
  normalizeKunImageGenerationSettings,
  normalizeKunMusicGenerationSettings,
  normalizeKunSpeechToTextSettings,
  normalizeKunTextToSpeechSettings,
  normalizeKunVideoGenerationSettings
} from './app-settings-kun-media'
import {
  mergeKunRuntimeSettings,
  mergeKunSubagentsSettings
} from './app-settings-kun-merge'
import {
  boundedPositiveInt,
  normalizeKunContextCompactionSettings,
  normalizeKunLlmDebugSettings,
  normalizeKunMcpSearchSettings,
  normalizeKunProjectConfigSettings,
  normalizeKunRuntimeTuningSettings,
  normalizeKunStorageSettings,
  normalizeKunTokenEconomySettings,
  normalizeKunToolOutputLimitsSettings
} from './app-settings-kun-tuning'

export const KUN_DESIGN_QUALITY_STRICTNESS: readonly KunDesignQualityStrictness[] = [
  'relaxed',
  'standard',
  'strict'
]

export function normalizeKunQualitySettings(
  input: Partial<KunDesignQualitySettingsV1> | undefined
): KunDesignQualitySettingsV1 {
  const defaults = defaultKunQualitySettings()
  const strictness =
    input?.strictness && KUN_DESIGN_QUALITY_STRICTNESS.includes(input.strictness)
      ? input.strictness
      : defaults.strictness
  const sanitizeList = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : defaults.ignoreRules
  return {
    enabled: input?.enabled !== false,
    strictness,
    ignoreRules: sanitizeList(input?.ignoreRules),
    ignoreFiles: sanitizeList(input?.ignoreFiles),
    maxFindings: boundedPositiveInt(input?.maxFindings, defaults.maxFindings, 100)
  }
}

export function normalizeKunModelProfiles(
  current: Record<string, ModelProviderModelProfileV1> | undefined,
  patch: Record<string, ModelProviderModelProfilePatchV1 | null> | undefined
): Record<string, ModelProviderModelProfileV1> {
  const profiles: Record<string, ModelProviderModelProfileV1> = {}
  for (const [rawModelId, rawProfile] of Object.entries(current ?? {})) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    profiles[modelId] = normalizeKunModelProfile(rawProfile)
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return profiles
  for (const [rawModelId, rawProfile] of Object.entries(patch)) {
    const modelId = normalizeModelProfileId(rawModelId)
    if (!modelId) continue
    if (rawProfile === null) {
      delete profiles[modelId]
      continue
    }
    profiles[modelId] = normalizeKunModelProfile({
      ...(profiles[modelId] ?? {}),
      ...rawProfile
    })
  }
  return profiles
}

export function normalizeKunModelProfile(
  input: ModelProviderModelProfilePatchV1 | undefined
): ModelProviderModelProfileV1 {
  const inputModalities = normalizeKunModelInputModalities(input?.inputModalities)
  const fallbackMessageParts: ModelProviderMessagePartSupport[] = inputModalities.includes('image')
    ? ['text', 'image_url']
    : ['text']
  const contextWindowTokens = typeof input?.contextWindowTokens === 'number' &&
    Number.isInteger(input.contextWindowTokens) &&
    input.contextWindowTokens > 0
    ? input.contextWindowTokens
    : undefined
  const maxOutputTokens = typeof input?.maxOutputTokens === 'number' &&
    Number.isInteger(input.maxOutputTokens) &&
    input.maxOutputTokens > 0
    ? input.maxOutputTokens
    : undefined
  const reasoning = normalizeKunReasoningCapability(input?.reasoning)
  const endpointFormat = typeof input?.endpointFormat === 'string' && input.endpointFormat.trim()
    ? normalizeModelEndpointFormat(input.endpointFormat)
    : undefined
  return {
    ...(normalizeKunProfileAliases(input?.aliases).length
      ? { aliases: normalizeKunProfileAliases(input?.aliases) }
      : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    inputModalities,
    outputModalities: normalizeKunModelInputModalities(input?.outputModalities),
    supportsToolCalling: input?.supportsToolCalling !== false,
    messageParts: normalizeKunModelMessageParts(input?.messageParts, fallbackMessageParts),
    ...(reasoning ? { reasoning } : {}),
    ...(endpointFormat ? { endpointFormat } : {})
  }
}

export function normalizeKunReasoningCapability(
  input: ModelProviderModelProfilePatchV1['reasoning'] | undefined
): ModelProviderReasoningCapabilityV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const supportedEfforts = normalizeKunReasoningEfforts(input.supportedEfforts)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort = normalizeKunReasoningEffort(input.defaultEffort)
  const requestProtocol = normalizeKunReasoningRequestProtocol(input.requestProtocol)
  if (!requestProtocol) return undefined
  return {
    supportedEfforts,
    defaultEffort: defaultEffort && supportedEfforts.includes(defaultEffort)
      ? defaultEffort
      : supportedEfforts[0],
    requestProtocol
  }
}

export function normalizeKunReasoningEfforts(value: unknown): ModelProviderReasoningCapabilityV1['supportedEfforts'] {
  if (!Array.isArray(value)) return []
  const efforts: ModelProviderReasoningCapabilityV1['supportedEfforts'] = []
  for (const item of value) {
    const effort = normalizeKunReasoningEffort(item)
    if (effort && !efforts.includes(effort)) efforts.push(effort)
  }
  return efforts
}

export function normalizeKunReasoningEffort(value: unknown): ModelProviderReasoningCapabilityV1['defaultEffort'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ModelProviderReasoningCapabilityV1['defaultEffort'])
    ? normalized as ModelProviderReasoningCapabilityV1['defaultEffort']
    : undefined
}

export function normalizeKunReasoningRequestProtocol(
  value: unknown
): ModelProviderReasoningCapabilityV1['requestProtocol'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_REQUEST_PROTOCOLS.includes(normalized as ModelProviderReasoningCapabilityV1['requestProtocol'])
    ? normalized as ModelProviderReasoningCapabilityV1['requestProtocol']
    : undefined
}

export function normalizeModelProfileId(value: string): string {
  return value.trim().slice(0, 128)
}

export function normalizeKunProfileAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const aliases: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const alias = item.trim().slice(0, 128)
    if (alias && !aliases.includes(alias)) aliases.push(alias)
    if (aliases.length >= 50) break
  }
  return aliases
}

export function normalizeKunModelInputModalities(value: unknown): ModelProviderInputModality[] {
  if (!Array.isArray(value)) return ['text']
  const modalities: ModelProviderInputModality[] = []
  for (const item of value) {
    if ((item === 'text' || item === 'image') && !modalities.includes(item)) {
      modalities.push(item)
    }
    if (modalities.length >= 8) break
  }
  return modalities.length > 0 ? modalities : ['text']
}

export function normalizeKunModelMessageParts(
  value: unknown,
  fallback: ModelProviderMessagePartSupport[]
): ModelProviderMessagePartSupport[] {
  if (!Array.isArray(value)) return [...fallback]
  const parts: ModelProviderMessagePartSupport[] = []
  for (const item of value) {
    if (
      (item === 'text' || item === 'image_url' || item === 'input_image') &&
      !parts.includes(item)
    ) {
      parts.push(item)
    }
    if (parts.length >= 8) break
  }
  return parts.length > 0 ? parts : [...fallback]
}

export function withKunRuntimeSettings(
  settings: AppSettingsV1,
  kun: KunRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: kunSettingsEnvelope(kun)
  }
}

export function applyKunRuntimePatch(
  settings: AppSettingsV1,
  patch: KunRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withKunRuntimeSettings(
    settings,
    mergeKunRuntimeSettings(getKunRuntimeSettings(settings), patch)
  )
}

export function isKunRuntimeInsecure(runtime: Pick<KunRuntimeSettingsV1, 'insecure' | 'runtimeToken'>): boolean {
  return runtime.insecure === true
}

export function getActiveAgentApiKey(settings: AppSettingsV1): string {
  return resolveKunRuntimeSettings(settings).apiKey?.trim() ?? ''
}

export function mergeAgentRuntimeSettings(
  defaults: KunSettingsEnvelopeV1,
  patch: KunSettingsEnvelopePatchV1 | undefined
): KunSettingsEnvelopeV1 {
  return kunSettingsEnvelope(
    mergeKunRuntimeSettings(defaults.kun, patch?.kun)
  )
}

type LegacyKunRuntimeSettingsInputV1 = Partial<Omit<KunRuntimeSettingsV1, 'subagents'>> & {
  subagents?: LegacyKunSubagentsSettingsInputV1
}

export type LegacyAgentsSettingsShape = {
  kun?: LegacyKunRuntimeSettingsInputV1
  codewhale?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  reasonix?: Partial<LegacyReasoningRuntimeSettingsV1>
}

export type LegacyAppSettingsShape = Partial<Omit<AppSettingsV1, 'agents' | 'provider'>> & {
  agents?: LegacyAgentsSettingsShape
  provider?: Partial<ModelProviderSettingsV1>
  deepseek?: Partial<LegacyLocalHttpRuntimeSettingsV1>
  /** Legacy single-provider discriminator. Read only inside migration. */
  agentProvider?: unknown
}

export function nonEmptyStringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function upgradeLegacyKunDefaultDataDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_KUN_DATA_DIR
  const trimmed = value.trim()
  const normalized = trimmed.replace(/\\/g, '/').toLowerCase()
  if (
    !trimmed ||
    normalized === LEGACY_COREAGENT_DATA_DIR ||
    normalized.endsWith('/.deepseekgui/coreagent')
  ) {
    return DEFAULT_KUN_DATA_DIR
  }
  return trimmed
}

export function upgradeLegacyKunDefaultModel(value: unknown, fallback: string): string {
  const model = nonEmptyStringOrFallback(value, fallback).trim()
  return model === LEGACY_KUN_DEFAULT_MODEL ? DEFAULT_KUN_MODEL : model
}

export function upgradeLegacyKunDefaultPort(value: unknown, fallback: number): number {
  return value === LEGACY_LOCAL_HTTP_DEFAULT_PORT ? DEFAULT_KUN_PORT : fallback
}

export function normalizeKunLocalPort(value: unknown, fallback: number): number {
  if (value === LEGACY_LOCAL_HTTP_DEFAULT_PORT || value === PREVIOUS_KUN_DEFAULT_PORT) {
    return DEFAULT_KUN_PORT
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(65_535, Math.max(MIN_KUN_LOCAL_PORT, Math.floor(parsed)))
}

export function migrateLegacyAppSettings(parsed: LegacyAppSettingsShape): Partial<AppSettingsV1> {
  const rawAgentProvider = parsed.agentProvider
  const isReasoningLegacy = rawAgentProvider === 'reasonix'
  const hasProviderSettings = typeof parsed.provider === 'object' && parsed.provider !== null
  const defaults = legacyLocalHttpRuntimeDefaults()
  const kunDefaults = legacyKunRuntimeSettingsDefaults()
  const legacyDeepseek = parsed.deepseek ?? {}
  const legacyLocalHttp = {
    ...defaults,
    ...(parsed.agents?.codewhale ?? {}),
    ...legacyDeepseek
  }
  const legacyReasoning = {
    ...legacyReasoningRuntimeDefaults(),
    ...(parsed.agents?.reasonix ?? {})
  }
  const explicitKunInput = parsed.agents?.kun ?? {}
  const { subagents: explicitSubagents, ...explicitKun } = explicitKunInput
  const legacySource = isReasoningLegacy ? legacyReasoning : legacyLocalHttp
  const legacySeed = {
    binaryPath: kunDefaults.binaryPath,
    port: isReasoningLegacy
      ? kunDefaults.port
      : upgradeLegacyKunDefaultPort(legacyLocalHttp.port, legacyLocalHttp.port),
    autoStart: isReasoningLegacy ? legacyReasoning.autoStart : legacyLocalHttp.autoStart,
    apiKey: legacySource.apiKey,
    baseUrl: legacySource.baseUrl,
    providerId: '',
    endpointFormat: DEFAULT_MODEL_ENDPOINT_FORMAT,
    retry: kunDefaults.retry,
    runtimeToken: isReasoningLegacy ? kunDefaults.runtimeToken : legacyLocalHttp.runtimeToken,
    model: isReasoningLegacy ? legacyReasoning.model : kunDefaults.model,
    approvalPolicy: isReasoningLegacy ? kunDefaults.approvalPolicy : legacyLocalHttp.approvalPolicy,
    sandboxMode: isReasoningLegacy ? kunDefaults.sandboxMode : legacyLocalHttp.sandboxMode,
    approvalReviewer: DEFAULT_APPROVAL_REVIEWER
  }
  const provider = normalizeModelProviderSettings({
    ...parsed.provider,
    apiKey: hasProviderSettings
      ? parsed.provider?.apiKey
      : nonEmptyStringOrFallback(explicitKun.apiKey, legacySeed.apiKey),
    baseUrl: hasProviderSettings
      ? parsed.provider?.baseUrl
      : nonEmptyStringOrFallback(explicitKun.baseUrl, legacySeed.baseUrl),
    proxy: parsed.provider?.proxy,
    providers: parsed.provider?.providers,
    routePools: parsed.provider?.routePools,
    localGateway: parsed.provider?.localGateway
  })
  const normalizedSubagents = mergeKunSubagentsSettings(kunDefaults.subagents, explicitSubagents)
  const kun: KunRuntimeSettingsV1 = {
    ...kunDefaults,
    ...legacySeed,
    ...explicitKun,
    port: normalizeKunLocalPort(explicitKun.port ?? legacySeed.port, kunDefaults.port),
    apiKey: hasProviderSettings ? explicitKun.apiKey ?? '' : '',
    baseUrl: hasProviderSettings ? explicitKun.baseUrl ?? '' : '',
    runtimeToken: nonEmptyStringOrFallback(explicitKun.runtimeToken, legacySeed.runtimeToken),
    dataDir: upgradeLegacyKunDefaultDataDir(explicitKun.dataDir),
    model: upgradeLegacyKunDefaultModel(explicitKun.model, legacySeed.model),
    approvalReviewer: normalizeApprovalReviewer(
      explicitKun.approvalReviewer ?? legacySeed.approvalReviewer
    ),
    tokenEconomyMode: typeof explicitKun.tokenEconomy?.enabled === 'boolean'
      ? explicitKun.tokenEconomy.enabled
      : explicitKun.tokenEconomyMode ?? kunDefaults.tokenEconomyMode,
    tokenEconomy: normalizeKunTokenEconomySettings(
      explicitKun.tokenEconomy,
      explicitKun.tokenEconomyMode ?? kunDefaults.tokenEconomyMode
    ),
    toolOutputLimits: normalizeKunToolOutputLimitsSettings(explicitKun.toolOutputLimits),
    mcpSearch: normalizeKunMcpSearchSettings(explicitKun.mcpSearch),
    githubMcp: normalizeGitHubMcpSettings(explicitKun.githubMcp),
    projectConfig: normalizeKunProjectConfigSettings(explicitKun.projectConfig),
    storage: normalizeKunStorageSettings(explicitKun.storage),
    contextCompaction: normalizeKunContextCompactionSettings(explicitKun.contextCompaction),
    runtimeTuning: normalizeKunRuntimeTuningSettings(explicitKun.runtimeTuning),
    llmDebug: normalizeKunLlmDebugSettings(explicitKun.llmDebug),
    imageGeneration: normalizeKunImageGenerationSettings(explicitKun.imageGeneration),
    speechToText: normalizeKunSpeechToTextSettings(explicitKun.speechToText),
    textToSpeech: normalizeKunTextToSpeechSettings(explicitKun.textToSpeech),
    musicGeneration: normalizeKunMusicGenerationSettings(explicitKun.musicGeneration),
    videoGeneration: normalizeKunVideoGenerationSettings(explicitKun.videoGeneration),
    quality: normalizeKunQualitySettings(explicitKun.quality),
    ...(normalizedSubagents !== undefined ? { subagents: normalizedSubagents } : {})
  }
  // Strip the legacy `agentProvider` discriminator and the legacy
  // per-provider settings from the surfaced migration result. The
  // runtime now has a single agent (Kun) and we no longer
  // round-trip the legacy value into the new settings shape.
  const { deepseek: _legacyDeepseek, agents: _agents, agentProvider: _agentProvider, ...rest } = parsed
  void _legacyDeepseek
  void _agents
  void _agentProvider
  return {
    ...rest,
    provider,
    agents: {
      kun
    }
  }
}
