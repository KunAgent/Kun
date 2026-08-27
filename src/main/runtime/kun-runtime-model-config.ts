import {
  defaultKunTokenEconomySettings,
  getModelProviderSettings,
  projectExecutableModelRoutePools,
  resolveKunRuntimeSettings,
  resolveModelProviderPresetSource,
  resolveModelProviderProxyUrl,
  type AppSettingsV1,
  type KunRuntimeSettingsV1,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1
} from '../../shared/app-settings'
import { legacyProviderCredentialSourceId } from '../legacy-provider-settings-migration'

const DEFAULT_KUN_MODEL_PROFILES: Record<string, Record<string, unknown>> = {
  'deepseek-v4-pro': {
    contextWindowTokens: 1_000_000,
    contextCompaction: { softThreshold: 980_000, hardThreshold: 990_000 },
    inputModalities: ['text'], outputModalities: ['text'],
    supportsToolCalling: true, messageParts: ['text']
  },
  'deepseek-v4-flash': {
    aliases: ['deepseek-chat', 'deepseek-reasoner'],
    contextWindowTokens: 1_000_000,
    contextCompaction: { softThreshold: 980_000, hardThreshold: 990_000 },
    inputModalities: ['text'], outputModalities: ['text'],
    supportsToolCalling: true, messageParts: ['text']
  }
}

export function modelConfigForRuntime(
  existing: Record<string, unknown>,
  guiModelProfiles: Record<string, ModelProviderModelProfileV1> = {}
): Record<string, unknown> {
  const existingProfiles = objectValue(existing.profiles)
  const guiProfiles = modelConfigProfilesFromProviderProfiles(guiModelProfiles)
  const profileDefaults = { ...DEFAULT_KUN_MODEL_PROFILES, ...guiProfiles }
  const profiles: Record<string, unknown> = {}
  for (const modelId of new Set([...Object.keys(profileDefaults), ...Object.keys(existingProfiles)])) {
    const defaultProfile = objectValue(profileDefaults[modelId])
    const existingProfile = objectValue(existingProfiles[modelId])
    const guiProfile = objectValue(guiProfiles[modelId])
    const baseProfile = Object.prototype.hasOwnProperty.call(guiProfiles, modelId)
      ? { ...defaultProfile, ...guiProfile }
      : { ...defaultProfile, ...existingProfile }
    profiles[modelId] = {
      ...baseProfile,
      contextCompaction: {
        ...objectValue(defaultProfile.contextCompaction),
        ...objectValue(existingProfile.contextCompaction),
        ...objectValue(guiProfile.contextCompaction)
      }
    }
  }
  return { ...existing, profiles }
}

export function providersConfigForRuntime(
  settings: AppSettingsV1
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const proxyUrl = resolveModelProviderProxyUrl(settings)
  const runtime = resolveKunRuntimeSettings(settings)
  for (const provider of getModelProviderSettings(settings).providers as ModelProviderProfileV1[]) {
    const id = provider.id?.trim()
    const baseUrl = provider.baseUrl?.trim()
    const isKeylessTransport =
      provider.kind === 'agent-sdk' ||
      provider.kind === 'antigravity-cli' ||
      provider.kind === 'gemini-cli-api' ||
      provider.kind === 'cursor-sdk'
    if (!id || (!baseUrl && !isKeylessTransport)) continue
    const credentialSourceId = provider.apiKey.trim()
      ? legacyProviderCredentialSourceId(id)
      : undefined
    const selectedModel = id === runtime.providerId && provider.models.includes(runtime.model)
      ? runtime.model
      : provider.models[0]
    const presetSource = resolveModelProviderPresetSource(provider)
    out[id] = {
      // Provider secrets live in the protected account store. The runtime
      // resolves this opaque source binding after reading config.json.
      apiKey: '',
      ...(credentialSourceId ? { credentialSourceId } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(provider.kind ? { kind: provider.kind } : {}),
      ...(presetSource ? { presetSource: presetSource.preset.id, presetMode: presetSource.mode } : {}),
      ...(presetSource?.mode === 'token-plan' || presetSource?.preset.category === 'subscription'
        ? { authType: 'subscription' }
        : {}),
      ...(provider.endpointFormat ? { endpointFormat: provider.endpointFormat } : {}),
      models: [...provider.models],
      modelCapabilities: modelCapabilitiesForProviderConfig(provider),
      ...(selectedModel ? { selectedModel } : {}),
      retry: provider.retry,
      modelProfiles: modelConfigProfilesFromProviderProfiles(provider.modelProfiles),
      ...(proxyUrl ? { modelProxyUrl: proxyUrl } : {}),
      // Credential-derived transport headers are reconstructed in Kun from
      // the protected binding and are never persisted in config.json.
    }
  }
  return out
}

function modelCapabilitiesForProviderConfig(
  provider: Pick<ModelProviderProfileV1, 'models' | 'modelProfiles'>
): Record<string, unknown> {
  return Object.fromEntries(provider.models.flatMap((model) => {
    const profile = provider.modelProfiles[model] ??
      provider.modelProfiles[model.trim().toLowerCase()]
    if (!profile) return []
    return [[model, {
      id: model,
      ...(profile.contextWindowTokens ? { contextWindowTokens: profile.contextWindowTokens } : {}),
      ...(profile.maxOutputTokens ? { maxOutputTokens: profile.maxOutputTokens } : {}),
      inputModalities: [...profile.inputModalities],
      outputModalities: [...profile.outputModalities],
      supportsToolCalling: profile.supportsToolCalling,
      messageParts: [...profile.messageParts],
      ...(profile.reasoning
        ? {
            reasoning: {
              supportedEfforts: [...profile.reasoning.supportedEfforts],
              defaultEffort: profile.reasoning.defaultEffort,
              requestProtocol: profile.reasoning.requestProtocol
            }
          }
        : {}),
      ...(profile.pricing ? { pricing: { ...profile.pricing } } : {}),
      ...(profile.serviceTiers ? { serviceTiers: [...profile.serviceTiers] } : {}),
      ...(profile.endpointFormat ? { endpointFormat: profile.endpointFormat } : {}),
      ...(profile.responsesMode ? { responsesMode: profile.responsesMode } : {})
    }]]
  }))
}

export function routePoolsConfigForRuntime(settings: AppSettingsV1) {
  const providerSettings = getModelProviderSettings(settings)
  return projectExecutableModelRoutePools(providerSettings)
}

export function localModelGatewayConfigForRuntime(settings: AppSettingsV1) {
  return { enabled: getModelProviderSettings(settings).localGateway.enabled }
}

export function tokenEconomyConfigForRuntime(
  tokenEconomy: Pick<KunRuntimeSettingsV1, 'tokenEconomy'>['tokenEconomy'] | undefined,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const defaults = defaultKunTokenEconomySettings()
  const normalized = {
    ...defaults,
    ...(tokenEconomy ?? {}),
    historyHygiene: { ...defaults.historyHygiene, ...(tokenEconomy?.historyHygiene ?? {}) }
  }
  const existingHistoryHygiene = objectValue(existing.historyHygiene)
  return {
    ...existing,
    enabled: normalized.enabled,
    compressToolDescriptions: normalized.compressToolDescriptions,
    compressToolResults: normalized.compressToolResults,
    conciseResponses: normalized.conciseResponses,
    historyHygiene: {
      ...existingHistoryHygiene,
      maxToolResultLines: normalized.historyHygiene.maxToolResultLines,
      maxToolResultBytes: normalized.historyHygiene.maxToolResultBytes,
      maxToolResultTokens: normalized.historyHygiene.maxToolResultTokens,
      maxToolArgumentStringBytes: normalized.historyHygiene.maxToolArgumentStringBytes,
      maxToolArgumentStringTokens: normalized.historyHygiene.maxToolArgumentStringTokens,
      maxArrayItems: normalized.historyHygiene.maxArrayItems
    }
  }
}

export function toolOutputLimitsConfigForRuntime(
  limits: Pick<KunRuntimeSettingsV1, 'toolOutputLimits'>['toolOutputLimits'] | undefined
): Record<string, unknown> {
  return { maxLines: limits?.maxLines, maxBytes: limits?.maxBytes }
}

export function storageConfigForRuntime(
  storage: Pick<KunRuntimeSettingsV1, 'storage'>['storage']
): Record<string, unknown> {
  const sqlitePath = storage.sqlitePath.trim()
  return { backend: storage.backend, ...(sqlitePath ? { sqlitePath } : {}) }
}

export function contextCompactionConfigForRuntime(
  value: Pick<KunRuntimeSettingsV1, 'contextCompaction'>['contextCompaction'],
  existing: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existing,
    defaultSoftThreshold: value.defaultSoftThreshold,
    defaultHardThreshold: value.defaultHardThreshold,
    summaryMode: value.summaryMode,
    summaryTimeoutMs: value.summaryTimeoutMs,
    summaryMaxTokens: value.summaryMaxTokens,
    summaryInputMaxBytes: value.summaryInputMaxBytes,
    ...(value.summaryModel ? { summaryModel: value.summaryModel } : {}),
    ...(value.summaryProviderId ? { summaryProviderId: value.summaryProviderId } : {})
  }
}

export function rolesConfigForRuntime(runtime: Pick<
  KunRuntimeSettingsV1,
  'smallModel' | 'smallModelProviderId' | 'smallModelAccountId' |
  'titleModel' | 'titleProviderId' | 'titleAccountId' |
  'summaryModel' | 'summaryProviderId' | 'summaryAccountId' |
  'codeReviewModel' | 'codeReviewProviderId' | 'codeReviewAccountId' |
  'titleReasoningEffort' | 'summaryReasoningEffort' | 'codeReviewReasoningEffort'
>): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (key: string, value: string | undefined): void => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed) out[key] = trimmed
  }
  put('smallModel', runtime.smallModel)
  put('smallModelProviderId', runtime.smallModelProviderId)
  put('smallModelAccountId', runtime.smallModelAccountId)
  put('titleModel', runtime.titleModel)
  put('titleProviderId', runtime.titleProviderId)
  put('titleAccountId', runtime.titleAccountId)
  put('summaryModel', runtime.summaryModel)
  put('summaryProviderId', runtime.summaryProviderId)
  put('summaryAccountId', runtime.summaryAccountId)
  put('codeReviewModel', runtime.codeReviewModel)
  put('codeReviewProviderId', runtime.codeReviewProviderId)
  put('codeReviewAccountId', runtime.codeReviewAccountId)
  put('titleReasoningEffort', runtime.titleReasoningEffort)
  put('summaryReasoningEffort', runtime.summaryReasoningEffort)
  put('codeReviewReasoningEffort', runtime.codeReviewReasoningEffort)
  return out
}

function modelConfigProfilesFromProviderProfiles(
  profiles: Record<string, ModelProviderModelProfileV1>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [modelId, profile] of Object.entries(profiles)) {
    const trimmed = modelId.trim()
    if (!trimmed) continue
    out[trimmed] = {
      ...(profile.aliases?.length ? { aliases: profile.aliases } : {}),
      ...(profile.contextWindowTokens ? { contextWindowTokens: profile.contextWindowTokens } : {}),
      ...(profile.maxOutputTokens ? { maxOutputTokens: profile.maxOutputTokens } : {}),
      inputModalities: profile.inputModalities,
      outputModalities: profile.outputModalities,
      supportsToolCalling: profile.supportsToolCalling,
      messageParts: profile.messageParts,
      ...(profile.reasoning ? { reasoning: profile.reasoning } : {}),
      ...(profile.pricing ? { pricing: { ...profile.pricing } } : {}),
      ...(profile.serviceTiers ? { serviceTiers: profile.serviceTiers } : {}),
      ...(profile.endpointFormat ? { endpointFormat: profile.endpointFormat } : {}),
      ...(profile.responsesMode ? { responsesMode: profile.responsesMode } : {})
    }
  }
  return out
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
