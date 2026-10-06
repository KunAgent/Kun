import { MODEL_METADATA_FIELDS, metadataEvidence } from '../../../../kun/src/contracts/model-metadata-evidence.js'
import {
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MAX_MODEL_CONTEXT_WINDOW_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS,
  MODEL_REASONING_EFFORTS,
  type ModelEndpointFormat,
  type ModelProviderModelPricingV1,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelReasoningEffort,
  type ModelReasoningRequestProtocol
} from '@shared/app-settings'
import { normalizeModelProviderPricing } from '@shared/app-settings-provider-capabilities'
import {
  DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS,
  isComposerChatModelId,
  isImageGenerationModelId,
  isMusicGenerationModelId,
  isSpeechToTextModelId,
  isTextToSpeechModelId,
  isVideoGenerationModelId
} from '@shared/app-settings-provider-core'

import { PROVIDER_WIDE_MODEL_KEY } from '@shared/app-settings-provider-capabilities'

export type ProviderModelKind = 'chat' | 'image' | 'speech' | 'tts' | 'music' | 'video'

export const PROVIDER_MODEL_KINDS: ProviderModelKind[] = ['chat', 'image', 'speech', 'tts', 'music', 'video']

/** Reasoning effort choices offered in the editor. `auto` stays internal-only. */
export const PROVIDER_MODEL_REASONING_EFFORT_CHOICES: ModelReasoningEffort[] =
  ['off', 'low', 'medium', 'high', 'max']

export const PROVIDER_MODEL_REASONING_PROTOCOLS: ModelReasoningRequestProtocol[] = [
  'deepseek-chat-completions',
  'glm-chat-completions',
  'mimo-chat-completions',
  'openai-chat-completions',
  'qwen-chat-completions',
  'thinking-toggle-chat-completions',
  'openai-responses',
  'anthropic-thinking',
  'none'
]

export const CONTEXT_WINDOW_PRESETS = [32_000, 64_000, 128_000, 256_000, 1_000_000] as const

export type ProviderModelForm = {
  kind: ProviderModelKind
  /** Empty when adding; the edited model id otherwise (rename removes this entry). */
  originalModelId: string
  modelId: string
  /** null means "not specified" — Kun falls back to its built-in default. */
  contextWindowTokens: number | null
  maxOutputTokens: number | null
  /**
   * Parsed pricing inputs. null means "no pricing" — all four inputs were
   * left empty. Inside, a null field means "left empty" and NaN marks
   * unparsable text, mirroring the context/max-output convention.
   */
  pricing: ProviderModelFormPricing | null
  visionInput: boolean
  supportsToolCalling: boolean
  parallelTools: boolean | null
  structuredOutput: boolean | null
  streaming: boolean | null
  reasoningEnabled: boolean
  reasoningEfforts: ModelReasoningEffort[]
  reasoningDefaultEffort: ModelReasoningEffort
  reasoningProtocol: ModelReasoningRequestProtocol
  /** Per-model wire-format override; null means "inherit the provider's format". */
  endpointFormat: ModelEndpointFormat | null
  /** Internal preset transport metadata; intentionally not exposed in the form UI. */
  responsesMode: 'lite' | null
  /** Upstream model name when a relay serves this model under its own id; empty = same as modelId. */
  wireModelId: string
  aliases: string[]
}

/** USD-per-1M-token prices entered in the model editor; null = empty, NaN = invalid text. */
export type ProviderModelFormPricing = {
  inputUsdPerMillion: number | null
  outputUsdPerMillion: number | null
  cacheReadUsdPerMillion: number | null
  cacheWriteUsdPerMillion: number | null
}

export type ProviderModelFormError =
  | { code: 'missingId' }
  | { code: 'duplicate'; kind: ProviderModelKind }
  | { code: 'invalidContextWindow' }
  | { code: 'contextWindowTooLarge'; maximum: number }
  | { code: 'invalidMaxOutput' }
  | { code: 'maxOutputTooLarge'; maximum: number }
  | { code: 'invalidPricing' }
  | { code: 'noReasoningEfforts' }

export type ProviderModelListEntry = {
  kind: ProviderModelKind
  modelId: string
}

export type ProviderModelIdGroups = Record<ProviderModelKind, string[]>

type ProviderConnectionHints = Pick<ModelProviderProfileV1, 'id' | 'baseUrl' | 'endpointFormat'>

export function defaultReasoningProtocolForProvider(
  provider: ProviderConnectionHints
): ModelReasoningRequestProtocol {
  if (provider.endpointFormat === 'messages') return 'anthropic-thinking'
  if (provider.endpointFormat === 'responses') return 'openai-responses'
  const host = provider.baseUrl.toLowerCase()
  if (
    provider.id.startsWith('bigmodel') ||
    provider.id.startsWith('zhipu') ||
    provider.id.startsWith('zai') ||
    host.includes('bigmodel.cn') ||
    host.includes('z.ai')
  ) return 'glm-chat-completions'
  if (provider.id.startsWith('xiaomi') || host.includes('xiaomimimo')) return 'mimo-chat-completions'
  return 'deepseek-chat-completions'
}

export function newProviderModelForm(
  kind: ProviderModelKind,
  provider: ProviderConnectionHints
): ProviderModelForm {
  return {
    kind,
    originalModelId: '',
    modelId: '',
    contextWindowTokens: kind === 'chat' ? DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS : null,
    maxOutputTokens: null,
    pricing: null,
    visionInput: false,
    supportsToolCalling: true,
    parallelTools: null, structuredOutput: null, streaming: null,
    reasoningEnabled: false,
    reasoningEfforts: [...PROVIDER_MODEL_REASONING_EFFORT_CHOICES],
    reasoningDefaultEffort: 'medium',
    reasoningProtocol: defaultReasoningProtocolForProvider(provider),
    endpointFormat: null,
    responsesMode: null,
    wireModelId: '',
    aliases: []
  }
}

export function providerModelFormForExisting(
  provider: ModelProviderProfileV1,
  kind: ProviderModelKind,
  modelId: string
): ProviderModelForm {
  const base: ProviderModelForm = {
    ...newProviderModelForm(kind, provider),
    originalModelId: modelId,
    modelId
  }
  if (kind !== 'chat') return { ...base, contextWindowTokens: null, maxOutputTokens: null }
  const profile = chatModelProfile(provider, modelId)
  if (!profile) return { ...base, contextWindowTokens: null, maxOutputTokens: null }
  return {
    ...base,
    contextWindowTokens: profile.contextWindowTokens ?? null,
    maxOutputTokens: profile.maxOutputTokens ?? null,
    pricing: profile.pricing
      ? {
          inputUsdPerMillion: profile.pricing.inputUsdPerMillion,
          outputUsdPerMillion: profile.pricing.outputUsdPerMillion,
          cacheReadUsdPerMillion: profile.pricing.cacheReadUsdPerMillion ?? null,
          cacheWriteUsdPerMillion: profile.pricing.cacheWriteUsdPerMillion ?? null
        }
      : null,
    visionInput: profile.inputModalities.includes('image'),
    supportsToolCalling: profile.supportsToolCalling,
    parallelTools: profile.parallelTools ?? null, structuredOutput: profile.structuredOutput ?? null, streaming: profile.streaming ?? null,
    reasoningEnabled: Boolean(profile.reasoning),
    reasoningEfforts: profile.reasoning
      ? sortReasoningEfforts(profile.reasoning.supportedEfforts)
      : base.reasoningEfforts,
    reasoningDefaultEffort: profile.reasoning?.defaultEffort ?? base.reasoningDefaultEffort,
    reasoningProtocol: profile.reasoning?.requestProtocol ?? base.reasoningProtocol,
    endpointFormat: profile.endpointFormat ?? null,
    responsesMode: profile.responsesMode ?? null,
    wireModelId: profile.wireModelId ?? '',
    aliases: [...(profile.aliases ?? [])]
  }
}

export function providerModelIds(
  provider: ModelProviderProfileV1,
  kind: ProviderModelKind
): string[] {
  if (kind === 'chat') return [...provider.models]
  if (kind === 'image') return [...(provider.image?.models ?? [])]
  if (kind === 'speech') return [...(provider.speech?.models ?? [])]
  if (kind === 'tts') return [...(provider.textToSpeech?.models ?? [])]
  if (kind === 'music') return [...(provider.music?.models ?? [])]
  return [...(provider.video?.models ?? [])]
}

export function providerModelListEntries(provider: ModelProviderProfileV1): ProviderModelListEntry[] {
  return PROVIDER_MODEL_KINDS.flatMap((kind) =>
    providerModelIds(provider, kind).map((modelId) => ({ kind, modelId }))
  )
}

export function classifyProviderModelIds(
  provider: ModelProviderProfileV1,
  modelIds: readonly string[]
): ProviderModelIdGroups {
  const groups: ProviderModelIdGroups = { chat: [], image: [], speech: [], tts: [], music: [], video: [] }
  const knownImageIds = new Set(providerModelIds(provider, 'image').map(modelKey))
  const knownSpeechIds = new Set(providerModelIds(provider, 'speech').map(modelKey))
  const knownTtsIds = new Set(providerModelIds(provider, 'tts').map(modelKey))
  const knownMusicIds = new Set(providerModelIds(provider, 'music').map(modelKey))
  const knownVideoIds = new Set(providerModelIds(provider, 'video').map(modelKey))
  const explicitNonChatIds = [
    ...providerModelIds(provider, 'image'),
    ...providerModelIds(provider, 'speech'),
    ...providerModelIds(provider, 'tts'),
    ...providerModelIds(provider, 'music'),
    ...providerModelIds(provider, 'video')
  ]
  const seenByKind: Record<ProviderModelKind, Set<string>> = {
    chat: new Set(),
    image: new Set(),
    speech: new Set(),
    tts: new Set(),
    music: new Set(),
    video: new Set()
  }

  for (const rawId of modelIds) {
    const modelId = rawId.trim()
    if (!modelId) continue
    const key = modelKey(modelId)
    if (knownVideoIds.has(key) || isVideoGenerationModelId(modelId)) {
      pushUniqueModelId(groups.video, seenByKind.video, modelId)
      continue
    }
    if (knownMusicIds.has(key) || isMusicGenerationModelId(modelId)) {
      pushUniqueModelId(groups.music, seenByKind.music, modelId)
      continue
    }
    if (knownTtsIds.has(key) || isTextToSpeechModelId(modelId)) {
      pushUniqueModelId(groups.tts, seenByKind.tts, modelId)
      continue
    }
    if (knownSpeechIds.has(key) || isSpeechToTextModelId(modelId)) {
      pushUniqueModelId(groups.speech, seenByKind.speech, modelId)
      continue
    }
    if (knownImageIds.has(key) || isImageGenerationModelId(modelId)) {
      pushUniqueModelId(groups.image, seenByKind.image, modelId)
      continue
    }
    if (isComposerChatModelId(modelId, explicitNonChatIds)) {
      pushUniqueModelId(groups.chat, seenByKind.chat, modelId)
    }
  }

  return groups
}

export function validateProviderModelForm(
  form: ProviderModelForm,
  provider: ModelProviderProfileV1
): ProviderModelFormError[] {
  const errors: ProviderModelFormError[] = []
  const modelId = form.modelId.trim()
  if (!modelId) {
    errors.push({ code: 'missingId' })
  } else {
    const duplicateKind = findDuplicateKind(form, provider, modelId)
    if (duplicateKind) errors.push({ code: 'duplicate', kind: duplicateKind })
  }
  if (
    form.contextWindowTokens !== null &&
    (!Number.isInteger(form.contextWindowTokens) || form.contextWindowTokens <= 0)
  ) {
    errors.push({ code: 'invalidContextWindow' })
  } else if (
    form.contextWindowTokens !== null &&
    form.contextWindowTokens > MAX_MODEL_CONTEXT_WINDOW_TOKENS
  ) {
    errors.push({ code: 'contextWindowTooLarge', maximum: MAX_MODEL_CONTEXT_WINDOW_TOKENS })
  }
  if (
    form.maxOutputTokens !== null &&
    (!Number.isInteger(form.maxOutputTokens) || form.maxOutputTokens <= 0)
  ) {
    errors.push({ code: 'invalidMaxOutput' })
  } else if (
    form.maxOutputTokens !== null &&
    form.maxOutputTokens > MAX_MODEL_OUTPUT_TOKENS
  ) {
    errors.push({ code: 'maxOutputTooLarge', maximum: MAX_MODEL_OUTPUT_TOKENS })
  }
  if (form.pricing && !providerModelFormPricingValid(form.pricing)) {
    errors.push({ code: 'invalidPricing' })
  }
  if (form.kind === 'chat' && form.reasoningEnabled && form.reasoningEfforts.length === 0) {
    errors.push({ code: 'noReasoningEfforts' })
  }
  return errors
}

/** Non-blocking guidance: the id matches a non-text pattern so the composer would hide it. */
export function chatModelIdLooksNonText(form: ProviderModelForm): boolean {
  const modelId = form.modelId.trim()
  return form.kind === 'chat' && Boolean(modelId) && !isComposerChatModelId(modelId)
}

export function applyProviderModelForm(
  provider: ModelProviderProfileV1,
  form: ProviderModelForm
): ModelProviderProfileV1 {
  const modelId = form.modelId.trim()
  if (!modelId) return provider
  const withoutOriginal = removeProviderModel(provider, form.kind, form.originalModelId)
  if (form.kind === 'image') {
    const image = withoutOriginal.image ?? {
      protocol: DEFAULT_IMAGE_GENERATION_PROTOCOL,
      baseUrl: withoutOriginal.baseUrl.trim(),
      models: []
    }
    return {
      ...withoutOriginal,
      image: { ...image, models: appendModelId(image.models, modelId) }
    }
  }
  if (form.kind === 'speech') {
    const speech = withoutOriginal.speech ?? {
      protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
      baseUrl: withoutOriginal.baseUrl.trim(),
      models: []
    }
    return {
      ...withoutOriginal,
      speech: { ...speech, models: appendModelId(speech.models, modelId) }
    }
  }
  if (form.kind === 'tts') {
    const textToSpeech = withoutOriginal.textToSpeech ?? {
      protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
      baseUrl: withoutOriginal.baseUrl.trim(),
      models: []
    }
    return {
      ...withoutOriginal,
      textToSpeech: { ...textToSpeech, models: appendModelId(textToSpeech.models, modelId) }
    }
  }
  if (form.kind === 'music') {
    const music = withoutOriginal.music ?? {
      protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
      baseUrl: withoutOriginal.baseUrl.trim(),
      models: []
    }
    return {
      ...withoutOriginal,
      music: { ...music, models: appendModelId(music.models, modelId) }
    }
  }
  if (form.kind === 'video') {
    const video = withoutOriginal.video ?? {
      protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
      baseUrl: withoutOriginal.baseUrl.trim(),
      models: []
    }
    return {
      ...withoutOriginal,
      video: { ...video, models: appendModelId(video.models, modelId) }
    }
  }
  if (modelId === PROVIDER_WIDE_MODEL_KEY) {
    // Provider-wide defaults live in the profiles only; `*` is never a selectable model.
    return { ...provider, modelProfiles: { ...provider.modelProfiles, [PROVIDER_WIDE_MODEL_KEY]: chatProfileFromForm(provider, form) } }
  }
  return {
    ...withoutOriginal,
    models: appendModelId(withoutOriginal.models, modelId),
    modelProfiles: {
      ...withoutOriginal.modelProfiles,
      [modelKey(modelId)]: chatProfileFromForm(provider, form)
    }
  }
}

export function removeProviderModel(
  provider: ModelProviderProfileV1,
  kind: ProviderModelKind,
  modelId: string
): ModelProviderProfileV1 {
  const trimmed = modelId.trim()
  if (!trimmed) return provider
  if (kind === 'image') {
    if (!provider.image) return provider
    return {
      ...provider,
      image: { ...provider.image, models: filterModelId(provider.image.models, trimmed) }
    }
  }
  if (kind === 'speech') {
    if (!provider.speech) return provider
    return {
      ...provider,
      speech: { ...provider.speech, models: filterModelId(provider.speech.models, trimmed) }
    }
  }
  if (kind === 'tts') {
    if (!provider.textToSpeech) return provider
    return {
      ...provider,
      textToSpeech: { ...provider.textToSpeech, models: filterModelId(provider.textToSpeech.models, trimmed) }
    }
  }
  if (kind === 'music') {
    if (!provider.music) return provider
    return {
      ...provider,
      music: { ...provider.music, models: filterModelId(provider.music.models, trimmed) }
    }
  }
  if (kind === 'video') {
    if (!provider.video) return provider
    return {
      ...provider,
      video: { ...provider.video, models: filterModelId(provider.video.models, trimmed) }
    }
  }
  const nextProfiles = { ...provider.modelProfiles }
  delete nextProfiles[modelKey(trimmed)]
  delete nextProfiles[trimmed]
  return {
    ...provider,
    models: filterModelId(provider.models, trimmed),
    modelProfiles: nextProfiles
  }
}

export function chatModelProfile(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  const trimmed = modelId.trim()
  if (!trimmed) return undefined
  return provider.modelProfiles[modelKey(trimmed)] ?? provider.modelProfiles[trimmed]
}

export function sortReasoningEfforts(efforts: readonly ModelReasoningEffort[]): ModelReasoningEffort[] {
  const wanted = new Set(efforts)
  return MODEL_REASONING_EFFORTS.filter((effort) => wanted.has(effort))
}

export function describeContextWindowTokens(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${tokens / 1_000}K`
  return String(tokens)
}

/** Accepts "128000", "128k", "1m", "1 M", and returns tokens, or null when unparsable/empty. */
export function parseContextWindowInput(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/[\s,_]/g, '')
  if (!text) return null
  const match = /^(\d+(?:\.\d+)?)([km]?)$/.exec(text)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const scale = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1
  const tokens = Math.round(value * scale)
  return tokens > 0 ? tokens : null
}

/**
 * Accepts a plain USD-per-1M-tokens number like "0.15" or "1.5e-3" and
 * tolerates a leading "$", commas and whitespace. Returns null for empty
 * input and NaN for unparsable text so the form can distinguish "left
 * blank" from "typed something invalid" (validation rejects NaN).
 */
export function parsePricingInput(raw: string): number | null {
  const text = raw.trim().replace(/[$,\s]/g, '')
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}

/**
 * Mirrors the runtime contract: input and output prices must both be
 * finite non-negative numbers, while the cache prices stay optional.
 */
function providerModelFormPricingValid(pricing: ProviderModelFormPricing): boolean {
  return (
    isUsdPerMillionPrice(pricing.inputUsdPerMillion) &&
    isUsdPerMillionPrice(pricing.outputUsdPerMillion) &&
    (pricing.cacheReadUsdPerMillion === null ||
      isUsdPerMillionPrice(pricing.cacheReadUsdPerMillion)) &&
    (pricing.cacheWriteUsdPerMillion === null ||
      isUsdPerMillionPrice(pricing.cacheWriteUsdPerMillion))
  )
}

function isUsdPerMillionPrice(value: number | null): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function pricingFromForm(
  pricing: ProviderModelFormPricing | null
): ModelProviderModelPricingV1 | undefined {
  if (!pricing) return undefined
  return normalizeModelProviderPricing({
    inputUsdPerMillion: pricing.inputUsdPerMillion ?? Number.NaN,
    outputUsdPerMillion: pricing.outputUsdPerMillion ?? Number.NaN,
    ...(pricing.cacheReadUsdPerMillion !== null
      ? { cacheReadUsdPerMillion: pricing.cacheReadUsdPerMillion }
      : {}),
    ...(pricing.cacheWriteUsdPerMillion !== null
      ? { cacheWriteUsdPerMillion: pricing.cacheWriteUsdPerMillion }
      : {})
  })
}

function chatProfileFromForm(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  form: ProviderModelForm
): ModelProviderModelProfileV1 {
  const aliases = normalizeAliases(form.aliases)
  // The form only covers part of the profile. Catalog metadata without an
  // editor field (serviceTiers) is carried over from the stored profile so
  // a routine edit cannot silently drop it; pricing is user-editable now,
  // so it comes from the form instead. On a rename the previous entry
  // lives under originalModelId.
  const previous = chatModelProfile(provider, form.originalModelId || form.modelId)
  const pricing = pricingFromForm(form.pricing)
  const profile: ModelProviderModelProfileV1 = {
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(form.contextWindowTokens && form.contextWindowTokens > 0
      ? { contextWindowTokens: form.contextWindowTokens }
      : {}),
    ...(form.maxOutputTokens && form.maxOutputTokens > 0
      ? { maxOutputTokens: form.maxOutputTokens }
      : {}),
    inputModalities: form.visionInput ? ['text', 'image'] : ['text'],
    outputModalities: ['text'],
    supportsToolCalling: form.supportsToolCalling,
    messageParts: form.visionInput ? ['text', 'image_url'] : ['text'],
    ...(form.reasoningEnabled && form.reasoningEfforts.length > 0
      ? { reasoning: reasoningCapabilityFromForm(form) }
      : {}),
    ...(pricing ? { pricing } : {}),
    ...(typeof form.parallelTools === 'boolean' ? { parallelTools: form.parallelTools } : {}),
    ...(typeof form.streaming === 'boolean' ? { streaming: form.streaming } : {}),
    ...(typeof form.structuredOutput === 'boolean' ? { structuredOutput: form.structuredOutput } : {}),
    ...(previous?.serviceTiers?.length ? { serviceTiers: [...previous.serviceTiers] } : {}),
    ...(form.endpointFormat ? { endpointFormat: form.endpointFormat } : {}),
    ...(form.responsesMode ? { responsesMode: form.responsesMode } : {}),
    ...(form.wireModelId.trim() && form.wireModelId.trim() !== form.modelId.trim() ? { wireModelId: form.wireModelId.trim() } : {})
  }
  const evidence = previous?.evidence ?? metadataEvidence({ ...previous }, 'user')
  const now = new Date().toISOString()
  const nextEvidence = metadataEvidence({ ...profile }, 'user', now)
  profile.evidence = { ...evidence }
  for (const field of MODEL_METADATA_FIELDS) {
    if (JSON.stringify(previous?.[field as keyof ModelProviderModelProfileV1]) !== JSON.stringify(profile[field as keyof ModelProviderModelProfileV1])) {
      profile.evidence[field] = nextEvidence[field]
    }
  }
  return profile

}

function reasoningCapabilityFromForm(form: ProviderModelForm): ModelProviderReasoningCapabilityV1 {
  const supportedEfforts = sortReasoningEfforts(form.reasoningEfforts)
  return {
    supportedEfforts,
    defaultEffort: supportedEfforts.includes(form.reasoningDefaultEffort)
      ? form.reasoningDefaultEffort
      : supportedEfforts[supportedEfforts.length - 1],
    requestProtocol: form.reasoningProtocol
  }
}

function findDuplicateKind(
  form: ProviderModelForm,
  provider: ModelProviderProfileV1,
  modelId: string
): ProviderModelKind | null {
  const key = modelKey(modelId)
  const originalKey = modelKey(form.originalModelId)
  for (const kind of PROVIDER_MODEL_KINDS) {
    for (const existing of providerModelIds(provider, kind)) {
      const existingKey = modelKey(existing)
      if (existingKey !== key) continue
      if (kind === form.kind && existingKey === originalKey) continue
      return kind
    }
  }
  return null
}

function appendModelId(models: readonly string[], modelId: string): string[] {
  const key = modelKey(modelId)
  const kept = models.filter((existing) => modelKey(existing) !== key)
  return [...kept, modelId]
}

function pushUniqueModelId(target: string[], seen: Set<string>, modelId: string): void {
  const key = modelKey(modelId)
  if (seen.has(key)) return
  seen.add(key)
  target.push(modelId)
}

function filterModelId(models: readonly string[], modelId: string): string[] {
  const key = modelKey(modelId)
  return models.filter((existing) => modelKey(existing) !== key)
}

function normalizeAliases(aliases: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const alias of aliases) {
    const trimmed = alias.trim()
    const key = modelKey(trimmed)
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function modelKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}
