import {
  DEFAULT_IMAGE_GENERATION_PROTOCOL,
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  MODEL_REASONING_EFFORTS,
  isComposerChatModelId,
  isImageGenerationModelId,
  isMusicGenerationModelId,
  isSpeechToTextModelId,
  isTextToSpeechModelId,
  isVideoGenerationModelId,
  type ModelEndpointFormat,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1,
  type ModelProviderReasoningCapabilityV1,
  type ModelReasoningEffort,
  type ModelReasoningRequestProtocol
} from '@shared/app-settings'

export type ProviderModelKind = 'chat' | 'image' | 'speech' | 'tts' | 'music' | 'video'

export const PROVIDER_MODEL_KINDS: ProviderModelKind[] = ['chat', 'image', 'speech', 'tts', 'music', 'video']

/** Reasoning effort choices offered in the editor. `auto` stays internal-only. */
export const PROVIDER_MODEL_REASONING_EFFORT_CHOICES: ModelReasoningEffort[] =
  ['off', 'low', 'medium', 'high', 'max']

export const PROVIDER_MODEL_REASONING_PROTOCOLS: ModelReasoningRequestProtocol[] = [
  'deepseek-chat-completions',
  'glm-chat-completions',
  'mimo-chat-completions',
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
  visionInput: boolean
  supportsToolCalling: boolean
  reasoningEnabled: boolean
  reasoningEfforts: ModelReasoningEffort[]
  reasoningDefaultEffort: ModelReasoningEffort
  reasoningProtocol: ModelReasoningRequestProtocol
  /** Per-model wire-format override; null means "inherit the provider's format". */
  endpointFormat: ModelEndpointFormat | null
  aliases: string[]
}

export type ProviderModelFormError =
  | { code: 'missingId' }
  | { code: 'duplicate'; kind: ProviderModelKind }
  | { code: 'invalidContextWindow' }
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
    contextWindowTokens: kind === 'chat' ? 128_000 : null,
    visionInput: false,
    supportsToolCalling: true,
    reasoningEnabled: false,
    reasoningEfforts: [...PROVIDER_MODEL_REASONING_EFFORT_CHOICES],
    reasoningDefaultEffort: 'medium',
    reasoningProtocol: defaultReasoningProtocolForProvider(provider),
    endpointFormat: null,
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
  if (kind !== 'chat') return { ...base, contextWindowTokens: null }
  const profile = chatModelProfile(provider, modelId)
  if (!profile) return { ...base, contextWindowTokens: null }
  return {
    ...base,
    contextWindowTokens: profile.contextWindowTokens ?? null,
    visionInput: profile.inputModalities.includes('image'),
    supportsToolCalling: profile.supportsToolCalling,
    reasoningEnabled: Boolean(profile.reasoning),
    reasoningEfforts: profile.reasoning
      ? sortReasoningEfforts(profile.reasoning.supportedEfforts)
      : base.reasoningEfforts,
    reasoningDefaultEffort: profile.reasoning?.defaultEffort ?? base.reasoningDefaultEffort,
    reasoningProtocol: profile.reasoning?.requestProtocol ?? base.reasoningProtocol,
    endpointFormat: profile.endpointFormat ?? null,
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
  return {
    ...withoutOriginal,
    models: appendModelId(withoutOriginal.models, modelId),
    modelProfiles: {
      ...withoutOriginal.modelProfiles,
      [modelKey(modelId)]: chatProfileFromForm(form)
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

/** Accepts "128000", "128k", "1m", "1 M" … and returns tokens, or null when unparsable/empty. */
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

function chatProfileFromForm(form: ProviderModelForm): ModelProviderModelProfileV1 {
  const aliases = normalizeAliases(form.aliases)
  return {
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(form.contextWindowTokens && form.contextWindowTokens > 0
      ? { contextWindowTokens: form.contextWindowTokens }
      : {}),
    inputModalities: form.visionInput ? ['text', 'image'] : ['text'],
    outputModalities: ['text'],
    supportsToolCalling: form.supportsToolCalling,
    messageParts: form.visionInput ? ['text', 'image_url'] : ['text'],
    ...(form.reasoningEnabled && form.reasoningEfforts.length > 0
      ? { reasoning: reasoningCapabilityFromForm(form) }
      : {}),
    ...(form.endpointFormat ? { endpointFormat: form.endpointFormat } : {})
  }
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
