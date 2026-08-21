import type {
  AppSettingsPatch,
  ImageGenerationProtocol,
  KunRuntimeSettingsPatchV1,
  KunRuntimeSettingsV1,
  ModelEndpointFormat,
  ModelProviderImageCapabilityV1,
  ModelProviderModelProfileV1,
  ModelProviderMusicCapabilityV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1,
  ModelProviderSpeechCapabilityV1,
  ModelProviderTextToSpeechCapabilityV1,
  ModelProviderVideoCapabilityV1,
  MusicGenerationProtocol,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from '@shared/app-settings'
import {
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  defaultMiniMaxMediaGenerationKunPatch,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  resolveModelProviderPresetSource
} from '@shared/app-settings'
import type {
  AntigravitySubscriptionModelCatalog
} from '@shared/kun-gui-api'
import type {
  ModelProviderPreset,
  ModelProviderSubscriptionRegion
} from '@shared/model-provider-presets'
import { GEMINI_CLI_API_REASONING } from '@shared/model-provider-preset-types'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'

import { providerModelListEntries } from './provider-model-editor'

export const MODEL_ENDPOINT_FORMAT_LABEL_KEYS: Record<ModelEndpointFormat, string> = {
  chat_completions: 'modelEndpointChatCompletions',
  responses: 'modelEndpointResponses',
  messages: 'modelEndpointMessages',
  custom_endpoint: 'modelEndpointCustomEndpoint'
}

export const IMAGE_GENERATION_PROTOCOL_LABEL_KEYS: Record<ImageGenerationProtocol, string> = {
  'openai-images': 'imageGenProtocolOpenAi',
  'minimax-image': 'imageGenProtocolMiniMax',
  'codex-responses-image': 'imageGenProtocolCodex',
  'grok-imagine-image': 'imageGenProtocolGrok',
  'volcengine-ark-image': 'imageGenProtocolVolcengineArk'
}

export const SPEECH_TO_TEXT_PROTOCOL_LABEL_KEYS: Partial<Record<SpeechToTextProtocol, string>> = {
  'openai-transcriptions': 'speechProtocolOpenAi',
  'mimo-asr': 'speechProtocolMimoAsr',
  'xai-stt': 'speechProtocolXaiStt',
  'gemini-audio': 'speechProtocolGeminiAudio',
  'gemini-cli-audio': 'speechProtocolGeminiCliAudio'
}

export const TEXT_TO_SPEECH_PROTOCOL_LABEL_KEYS: Record<TextToSpeechProtocol, string> = {
  'openai-speech': 'textToSpeechProtocolOpenAi',
  'minimax-t2a': 'textToSpeechProtocolMiniMax',
  'mimo-tts': 'textToSpeechProtocolMimo'
}

export const MUSIC_GENERATION_PROTOCOL_LABEL_KEYS: Record<MusicGenerationProtocol, string> = {
  'minimax-music': 'musicGenerationProtocolMiniMax'
}

export const VIDEO_GENERATION_PROTOCOL_LABEL_KEYS: Record<VideoGenerationProtocol, string> = {
  'minimax-video': 'videoGenerationProtocolMiniMax',
  'grok-imagine-video': 'videoGenerationProtocolGrok',
  'volcengine-ark-video': 'videoGenerationProtocolVolcengineArk'
}

export type ProviderTaskTab = 'connection' | 'models' | 'capabilities' | 'advanced'
export type ProviderWorkspaceMode = 'providers' | 'routes'
export type ProviderCapability = 'image' | 'speech' | 'tts' | 'music' | 'video'
export type SubscriptionRegionFilter = 'all' | ModelProviderSubscriptionRegion

export function antigravityProviderCatalogPatch(
  catalog: AntigravitySubscriptionModelCatalog,
  existingProfiles: Readonly<Record<string, ModelProviderModelProfileV1>> = {}
): Pick<ModelProviderProfileV1, 'models' | 'modelProfiles'> {
  const models = catalog.models.map((model) => model.id)
  const modelProfiles = Object.fromEntries(catalog.models.map((model) => {
    const existing = existingProfiles[model.id]
    const supportsImageInput = /^(?:gemini|claude)-/i.test(model.id)
    return [
      model.id,
      {
        ...existing,
        inputModalities: existing?.inputModalities ?? (
          supportsImageInput ? ['text', 'image'] : ['text']
        ),
        outputModalities: existing?.outputModalities ?? ['text'],
        supportsToolCalling: existing?.supportsToolCalling ?? true,
        messageParts: existing?.messageParts ?? (
          supportsImageInput ? ['text', 'image_url'] : ['text']
        ),
        reasoning: {
          supportedEfforts: [...model.supportedEfforts],
          defaultEffort: model.defaultEffort,
          requestProtocol: 'none'
        }
      } satisfies ModelProviderModelProfileV1
    ]
  }))
  return { models, modelProfiles }
}

export const PROVIDER_TASK_TABS: Array<{ id: ProviderTaskTab; labelKey: string }> = [
  { id: 'connection', labelKey: 'modelProviderTabConnection' },
  { id: 'models', labelKey: 'modelProviderTabModels' },
  { id: 'capabilities', labelKey: 'modelProviderTabCapabilities' },
  { id: 'advanced', labelKey: 'modelProviderTabAdvanced' }
]

/**
 * Merge the Gemini CLI Code Assist sync catalog into a provider without
 * dropping ids the user added manually (e.g. a newer `gemini-3.7-*` release
 * the bootstrap catalog has not caught up with). Synced ids keep their wire
 * casing; unknown ids get a conservative text+vision tool-calling profile so
 * the main chat picker treats them as usable models.
 */
export function geminiCliApiCatalogPatch(
  syncedModels: readonly string[],
  currentModels: readonly string[],
  currentProfiles: Readonly<Record<string, ModelProviderModelProfileV1>>
): Pick<ModelProviderProfileV1, 'models' | 'modelProfiles'> {
  const merged: string[] = []
  const seen = new Set<string>()
  const keyOf = (model: string): string => model.trim().toLowerCase()
  const profilesByLowerKey = new Map(
    Object.entries(currentProfiles).map(([id, profile]) => [keyOf(id), profile])
  )
  for (const model of [...syncedModels, ...currentModels]) {
    const id = model.trim()
    const key = keyOf(id)
    if (!id || seen.has(key)) continue
    seen.add(key)
    merged.push(id)
  }
  const modelProfiles = Object.fromEntries(merged.map((model) => {
    const existing = profilesByLowerKey.get(keyOf(model))
    if (existing) return [model, existing]
    return [model, {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url'],
      reasoning: { ...GEMINI_CLI_API_REASONING }
    } satisfies ModelProviderModelProfileV1]
  }))
  return { models: merged, modelProfiles }
}

export const SUBSCRIPTION_REGION_TABS: Array<{
  id: SubscriptionRegionFilter
  labelKey: string
}> = [
  { id: 'all', labelKey: 'modelProviderSubscriptionRegionAll' },
  { id: 'china', labelKey: 'modelProviderSubscriptionRegionChina' },
  { id: 'united-states', labelKey: 'modelProviderSubscriptionRegionUnitedStates' }
]

/** Primary chat model ids must be non-empty for settings:set (modelIdSchema). */
export function nonEmptyModelId(value: string | undefined | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

/**
 * Build a kun selection patch that never emits `model: ''`, which Zod rejects
 * as `Too small: expected string to have >= 1 characters`.
 */
export function kunProviderSelectionPatch(input: {
  providerId: string
  model?: string | null
}): KunRuntimeSettingsPatchV1 {
  const model = nonEmptyModelId(input.model)
  return {
    providerId: input.providerId,
    ...(model ? { model } : {})
  }
}

export function modelProvidersSettingsPatch(input: {
  provider: ModelProviderSettingsV1
  providers: ModelProviderProfileV1[]
  kun?: KunRuntimeSettingsPatchV1
  currentKun?: Partial<KunRuntimeSettingsV1>
}): AppSettingsPatch {
  const defaultProvider = input.providers.find((item) => item.id === DEFAULT_MODEL_PROVIDER_ID)
  const miniMaxMediaDefaults = defaultMiniMaxMediaGenerationKunPatch({
    providers: input.providers,
    currentKun: input.currentKun,
    kunPatch: input.kun
  })
  const baseKunPatch = input.kun?.providerId?.trim()
    ? { ...input.kun, apiKey: '', baseUrl: '' }
    : input.kun ?? {}
  const { model: rawModel, ...kunWithoutModel } = baseKunPatch as KunRuntimeSettingsPatchV1 & {
    model?: string
  }
  const model = nonEmptyModelId(rawModel)
  const kunPatch = {
    ...kunWithoutModel,
    ...(model ? { model } : {}),
    ...(miniMaxMediaDefaults ?? {})
  }
  return {
    provider: {
      apiKey: defaultProvider?.apiKey ?? input.provider.apiKey,
      baseUrl: defaultProvider?.baseUrl ?? input.provider.baseUrl,
      proxy: input.provider.proxy,
      providers: input.providers,
      routePools: input.provider.routePools,
      localGateway: input.provider.localGateway
    },
    ...(Object.keys(kunPatch).length > 0 ? { agents: { kun: kunPatch } } : {})
  }
}

export function tokenPlanPresetForProfile(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): ModelProviderPreset | null {
  const source = resolveModelProviderPresetSource(provider)
  return source?.mode === 'token-plan' ? source.preset : null
}

// 「套餐订阅」组 = Token Plan 套餐档(<id>-token-plan)或本身就是订阅制的预设(category==='subscription');
// 其余(默认 / 按量预设 / 自定义)归入「按量 API」组,便于一眼分辨两类计费方式。
export function isAgentSdkProvider(provider: ModelProviderProfileV1): boolean {
  return provider.kind === 'agent-sdk'
}

export function isCursorSubscriptionProvider(provider: ModelProviderProfileV1): boolean {
  return provider.kind === 'cursor-sdk'
}

export const CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL = 'cursor-subscription:discover'

export function cursorSubscriptionDiscoveryErrorMessage(
  error: unknown,
  bridgeUnavailableMessage: string
): string {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes(`No handler registered for '${CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL}'`)
    || message.includes(`No bridge registered for '${CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL}'`)
    || /cursorSubscriptionDiscover.*not a function/i.test(message)
  ) {
    return bridgeUnavailableMessage
  }
  return message
}

export function isDelegatedEndpointProvider(provider: ModelProviderProfileV1): boolean {
  return isAgentSdkProvider(provider)
    || isGeminiSubscriptionProvider(provider)
    || isGeminiCliApiSubscriptionProvider(provider)
    || isCursorSubscriptionProvider(provider)
}

export function isSubscriptionProvider(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): boolean {
  const source = resolveModelProviderPresetSource(provider)
  return source?.mode === 'token-plan' || source?.preset.category === 'subscription'
}

export function addedModelCount(current: readonly string[], next: readonly string[]): number {
  const currentIds = new Set(current.map((model) => model.trim().toLowerCase()).filter(Boolean))
  return next.filter((model) => {
    const id = model.trim().toLowerCase()
    return id && !currentIds.has(id)
  }).length
}

export function providerModelCount(provider: ModelProviderProfileV1): number {
  return providerModelListEntries(provider).length
}

export function defaultImageCapability(baseUrl: string): ModelProviderImageCapabilityV1 {
  return {
    protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

export function defaultSpeechCapability(baseUrl: string): ModelProviderSpeechCapabilityV1 {
  return {
    protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

export function defaultTextToSpeechCapability(baseUrl: string): ModelProviderTextToSpeechCapabilityV1 {
  return {
    protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

export function defaultMusicCapability(baseUrl: string): ModelProviderMusicCapabilityV1 {
  return {
    protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

export function defaultVideoCapability(baseUrl: string): ModelProviderVideoCapabilityV1 {
  return {
    protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
    baseUrl: baseUrl.trim(),
    models: []
  }
}

export function profileForModel(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  model: string
): ModelProviderModelProfileV1 | undefined {
  const trimmed = model.trim()
  if (!trimmed) return undefined
  return provider.modelProfiles[trimmed.toLowerCase()] ?? provider.modelProfiles[trimmed]
}

export function cursorProviderNeedsMetadataRepair(provider: ModelProviderProfileV1): boolean {
  if (!isCursorSubscriptionProvider(provider)) return false
  return provider.models.some((model) => {
    if (model.trim().toLowerCase() === 'auto') return false
    const profile = profileForModel(provider, model)
    return !profile || (
      profile.contextWindowTokens === undefined
      && profile.maxOutputTokens === undefined
    ) || !profile.reasoning
  })
}

export function presetProfileForProvider(provider: ModelProviderProfileV1): ModelProviderProfileV1 | null {
  const source = resolveModelProviderPresetSource(provider)
  if (!source) return null
  return source.mode === 'token-plan'
    ? modelProviderTokenPlanProfile(source.preset, '', provider.baseUrl)
    : modelProviderPresetProfile(source.preset)
}

export function presetImageCapability(provider: ModelProviderProfileV1): ModelProviderImageCapabilityV1 | null {
  return presetProfileForProvider(provider)?.image ?? null
}

export function presetSpeechCapability(provider: ModelProviderProfileV1): ModelProviderSpeechCapabilityV1 | null {
  return presetProfileForProvider(provider)?.speech ?? null
}

export function presetTextToSpeechCapability(provider: ModelProviderProfileV1): ModelProviderTextToSpeechCapabilityV1 | null {
  return presetProfileForProvider(provider)?.textToSpeech ?? null
}

export function presetMusicCapability(provider: ModelProviderProfileV1): ModelProviderMusicCapabilityV1 | null {
  return presetProfileForProvider(provider)?.music ?? null
}

export function presetVideoCapability(provider: ModelProviderProfileV1): ModelProviderVideoCapabilityV1 | null {
  return presetProfileForProvider(provider)?.video ?? null
}

export function isAcceptableHttpUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    new URL(trimmed)
    return true
  } catch {
    return false
  }
}

export function providerConnectionFingerprint(provider: ModelProviderProfileV1): string {
  return [provider.baseUrl, provider.apiKey, provider.endpointFormat].join('\0')
}

export type ProbeState = {
  fingerprint: string
  mode: 'test' | 'fetch'
  status: 'busy' | 'ok' | 'error'
  latencyMs?: number
  total?: number
  message?: string
  suggestedProxyUrl?: string
}

export function isCodexProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'codex'
}

export function isGrokSubscriptionProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'grok-subscription'
}

export function isGeminiSubscriptionProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'gemini-subscription'
}

export function isGeminiCliApiSubscriptionProvider(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>
): boolean {
  return resolveModelProviderPresetSource(provider)?.preset.id === 'gemini-cli-subscription'
}

export function isOAuthSubscriptionProvider(provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'>): boolean {
  return isCodexProvider(provider)
    || isGrokSubscriptionProvider(provider)
    || isGeminiSubscriptionProvider(provider)
    || isGeminiCliApiSubscriptionProvider(provider)
}

export function parseCodexEmail(apiKey: string): string | undefined {
  if (!apiKey.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>
    if (parsed.kind === 'codex-oauth' && typeof parsed.email === 'string') return parsed.email
    if (parsed.kind === 'codex-oauth') return parsed.accountId as string
  } catch { /* ignore */ }
  return undefined
}

export function parseGrokIdentity(apiKey: string): string | undefined {
  if (!apiKey.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(apiKey) as Record<string, unknown>
    if (parsed.kind !== 'grok-oauth') return undefined
    if (typeof parsed.email === 'string' && parsed.email) return parsed.email
    if (typeof parsed.userId === 'string' && parsed.userId) return parsed.userId
  } catch { /* ignore */ }
  return undefined
}
