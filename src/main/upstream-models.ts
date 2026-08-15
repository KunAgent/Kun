import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getModelProviderSettings,
  getModelProviderProfile,
  isComposerChatModelId,
  isProviderComposerChatModelId,
  listModelProviderModelIds,
  listNonTextModelIds,
  modelProviderModelProfile,
  projectExecutableModelRoutePools,
  resolveModelProviderPresetSource,
  resolveKunRuntimeSettings,
  type AppSettingsV1,
  type ModelProviderModelProfileV1
} from '../shared/app-settings'
import { DEFAULT_COMPOSER_MODEL_IDS } from '../shared/default-composer-models'
import type {
  ModelProviderModelGroup,
  ModelProviderModelSelection
} from '../shared/kun-gui-api'
import { assertManagedKunDataDirIsCurrent } from './kun-data-dir-paths'

export type FetchUpstreamModelsResult =
  | {
      ok: true
      modelIds: string[]
      /** @deprecated Use defaultModel so the provider binding is not ambiguous. */
      defaultModelId?: string
      defaultModel?: ModelProviderModelSelection
      modelGroups?: ModelProviderModelGroup[]
    }
  | { ok: false; message: string }

const LOCAL_MODEL_GATEWAY_PROVIDER_ID = 'route-gateway:local'

export function fallbackModelIds(): string[] {
  return sortComposerModelIds(DEFAULT_COMPOSER_MODEL_IDS)
}

/**
 * Builds the model list the composer picker shows. Despite the historical name,
 * this intentionally mirrors only the models the user has explicitly added to
 * each provider (`provider.models`) — it does NOT query the provider's full
 * upstream `GET /v1/models` catalog.
 *
 * Pulling the whole catalog (issue #337) buried the few configured models under
 * hundreds of upstream ids (e.g. every OpenRouter / Aliyun model) and surfaced
 * ids that error when actually used. Custom-endpoint providers never triggered
 * it, which is why only preset providers were affected. Discover and add
 * upstream models deliberately via "从 API 拉取" (probeModelProvider) in
 * Settings instead.
 *
 * The second argument is kept for call-site compatibility; the upstream key is
 * no longer needed here.
 */
export async function fetchUpstreamModelIds(
  settings: AppSettingsV1,
  _apiKey?: string
): Promise<FetchUpstreamModelsResult> {
  const configuredModelIds = await readConfiguredKunModelIds(settings)
  const configuredGroups = await readConfiguredModelGroups(settings)
  const runtime = resolveKunRuntimeSettings(settings)
  const runtimeModel = runtime.model.trim()
  const runtimeProvider = getModelProviderProfile(settings, runtime.providerId)
  const defaultModel = isProviderComposerChatModelId(runtimeProvider, runtimeModel)
    ? { providerId: runtimeProvider.id, modelId: runtimeModel }
    : undefined
  return modelListOrError(
    configuredModelIds,
    configuredGroups,
    defaultModel,
    'Configured providers have no usable text models yet.'
  )
}

/**
 * Project the runtime's revisioned, secret-free model registry into the
 * composer's existing picker contract. This is the live authority used when
 * GUI and TUI are open together; settings remain a startup fallback only.
 */
export function modelListFromSharedConnections(
  value: unknown,
  localGatewayName = 'Kun API',
  configuredProviderLabels: ReadonlyMap<string, string> = new Map()
): FetchUpstreamModelsResult | null {
  const root = objectValue(value)
  if (root.schemaVersion !== 1 || !Array.isArray(root.providers)) return null
  const groups: ModelProviderModelGroup[] = root.providers.flatMap((raw) => {
    const profile = objectValue(raw)
    const credentialUnavailable = profile.credentialStatus === 'missing' ||
      profile.credentialStatus === 'unreadable'
    if (
      profile.configured !== true ||
      credentialUnavailable ||
      typeof profile.id !== 'string' ||
      !profile.id.trim() ||
      !Array.isArray(profile.models)
    ) {
      return []
    }
    const modelIds = profile.models.flatMap((model) =>
      typeof model === 'string' && model.trim() ? [model.trim()] : []
    )
    if (modelIds.length === 0) return []
    const capabilities = objectValue(profile.modelCapabilities)
    const modelProfiles = Object.fromEntries(modelIds.flatMap((model) => {
      const capability = objectValue(capabilities[model] ?? capabilities[model.toLowerCase()])
      const inputModalities = stringValues(capability.inputModalities)
        .filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
      const outputModalities = stringValues(capability.outputModalities)
        .filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
      const messageParts = stringValues(capability.messageParts)
        .filter((item): item is 'text' | 'image_url' | 'input_image' =>
          item === 'text' || item === 'image_url' || item === 'input_image'
        )
      const reasoning = sharedReasoningProfile(capability.reasoning)
      return [[model, {
        inputModalities: inputModalities.length ? inputModalities : ['text'],
        outputModalities: outputModalities.length ? outputModalities : ['text'],
        supportsToolCalling: capability.supportsToolCalling !== false,
        messageParts: messageParts.length ? messageParts : ['text'],
        ...(positiveInteger(capability.contextWindowTokens)
          ? { contextWindowTokens: positiveInteger(capability.contextWindowTokens) }
          : {}),
        ...(positiveInteger(capability.maxOutputTokens)
          ? { maxOutputTokens: positiveInteger(capability.maxOutputTokens) }
          : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(sharedServiceTiers(capability.serviceTiers).length
          ? { serviceTiers: sharedServiceTiers(capability.serviceTiers) }
          : {}),
        ...(isModelEndpointFormat(capability.endpointFormat)
          ? { endpointFormat: capability.endpointFormat }
          : {}),
        ...(capability.responsesMode === 'lite' ? { responsesMode: 'lite' as const } : {})
      } satisfies ModelProviderModelProfileV1]]
    }))
    const providerId = profile.id.trim()
    const configuredLabel = configuredProviderLabels.get(providerId.toLowerCase())?.trim()
    return [{
      providerId,
      ...(typeof profile.presetSource === 'string' && profile.presetSource.trim()
        ? { presetSource: profile.presetSource.trim() }
        : {}),
      label: configuredLabel ||
        (typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : providerId),
      modelIds,
      modelProfiles,
      ...(typeof profile.accountId === 'string' && profile.accountId.trim()
        ? { accountId: profile.accountId.trim() }
        : {})
    }]
  })
  const routeModelIds: string[] = []
  const routeModelProfiles: Record<string, ModelProviderModelProfileV1> = {}
  const providerGroups = new Map(groups.map((group) => [group.providerId.toLowerCase(), group]))
  for (const rawPool of Array.isArray(root.routePools) ? root.routePools : []) {
    const pool = objectValue(rawPool)
    const modelId = typeof pool.modelId === 'string' ? pool.modelId.trim() : ''
    if (pool.enabled !== true || !modelId || !Array.isArray(pool.targets)) continue
    const profiles = pool.targets.flatMap((rawTarget) => {
      const target = objectValue(rawTarget)
      if (target.enabled === false) return []
      const providerId = typeof target.providerId === 'string'
        ? target.providerId.trim().toLowerCase()
        : ''
      const targetModelId = typeof target.modelId === 'string' ? target.modelId.trim() : ''
      const group = providerGroups.get(providerId)
      if (!group || !targetModelId) return []
      const configuredModelId = group.modelIds.find(
        (candidate) => candidate.trim().toLowerCase() === targetModelId.toLowerCase()
      )
      if (!configuredModelId) return []
      return [group.modelProfiles?.[configuredModelId] ?? {
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      } satisfies ModelProviderModelProfileV1]
    })
    if (profiles.length === 0) continue
    routeModelIds.push(modelId)
    routeModelProfiles[modelId] = aggregateRouteModelProfile(profiles)
  }
  if (routeModelIds.length > 0) {
    groups.push({
      providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID,
      label: localGatewayName.trim() || 'Kun API',
      modelIds: routeModelIds,
      modelProfiles: routeModelProfiles
    })
  }
  const modelIds = groups.flatMap((group) => group.modelIds)
  if (modelIds.length === 0) {
    return {
      ok: false,
      message: 'No connected provider has a usable text model yet.'
    }
  }
  const defaultModelId = typeof root.defaultModel === 'string' ? root.defaultModel.trim() : ''
  const usableDefaultModelId = modelIds.includes(defaultModelId) ? defaultModelId : ''
  return {
    ok: true,
    modelIds: sortComposerModelIds(modelIds),
    ...(usableDefaultModelId ? { defaultModelId: usableDefaultModelId } : {}),
    modelGroups: mergeModelGroups(groups)
  }
}

export async function readConfiguredKunModelIds(settings: AppSettingsV1): Promise<string[]> {
  const runtime = resolveKunRuntimeSettings(settings)
  const dataDir = expandHome(runtime.dataDir)
  assertManagedKunDataDirIsCurrent(dataDir)
  const configPath = join(dataDir, 'config.json')
  const nonTextModelIds = listNonTextModelIds(settings)
  const ids = [
    ...(isComposerChatModelId(runtime.model, nonTextModelIds) ? [runtime.model] : []),
    ...listModelProviderModelIds(settings)
  ]
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  } catch {
    return mergeModelIds(ids)
  }
  const root = objectValue(parsed)
  const models = objectValue(root.models)
  const contextCompaction = objectValue(root.contextCompaction)
  return mergeModelIds([
    ...ids,
    ...modelIdsFromProfiles(objectValue(contextCompaction.modelProfiles), nonTextModelIds),
    ...modelIdsFromProfiles(objectValue(models.profiles), nonTextModelIds)
  ])
}

function modelListOrError(
  ids: readonly string[],
  groups: readonly ModelProviderModelGroup[],
  defaultModel: ModelProviderModelSelection | undefined,
  message: string
): FetchUpstreamModelsResult {
  return hasCustomModelId(ids)
    ? {
        ok: true,
        modelIds: mergeModelIds(ids),
        ...(defaultModel
          ? { defaultModelId: defaultModel.modelId, defaultModel }
          : {}),
        modelGroups: mergeModelGroups(groups)
      }
    : { ok: false, message }
}

async function readConfiguredModelGroups(settings: AppSettingsV1): Promise<ModelProviderModelGroup[]> {
  const groups: ModelProviderModelGroup[] = []
  for (const provider of getModelProviderSettings(settings).providers) {
    const modelIds = provider.models.filter((id) => isProviderComposerChatModelId(provider, id))
    if (modelIds.length === 0) continue
    const presetSource = resolveModelProviderPresetSource(provider)?.preset.id
    groups.push({
      providerId: provider.id,
      ...(presetSource ? { presetSource } : {}),
      label: provider.name,
      modelIds,
      modelProfiles: provider.modelProfiles
    })
  }
  const providerSettings = getModelProviderSettings(settings)
  const routeModelIds: string[] = []
  const routeModelProfiles: Record<string, ModelProviderModelProfileV1> = {}
  for (const pool of projectExecutableModelRoutePools(providerSettings)) {
    if (!pool.enabled || pool.targets.length === 0) continue
    const profiles = pool.targets.flatMap((target) => {
      const provider = providerSettings.providers.find((candidate) => candidate.id === target.providerId)
      return provider ? [modelProviderModelProfile(provider, target.modelId) ?? {
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      } satisfies ModelProviderModelProfileV1] : []
    })
    if (profiles.length === 0) continue
    routeModelIds.push(pool.modelId)
    routeModelProfiles[pool.modelId] = aggregateRouteModelProfile(profiles)
  }
  if (routeModelIds.length > 0) {
    groups.push({
      providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID,
      label: providerSettings.localGateway.name,
      modelIds: routeModelIds,
      modelProfiles: routeModelProfiles
    })
  }
  return mergeModelGroups(groups)
}

function aggregateRouteModelProfile(
  profiles: readonly ModelProviderModelProfileV1[]
): ModelProviderModelProfileV1 {
  const inputModalities = [...new Set(profiles.flatMap((profile) => profile.inputModalities))]
  const outputModalities = [...new Set(profiles.flatMap((profile) => profile.outputModalities))]
  const messageParts = [...new Set(profiles.flatMap((profile) => profile.messageParts))]
  return {
    inputModalities,
    outputModalities,
    messageParts,
    supportsToolCalling: profiles.some((profile) => profile.supportsToolCalling),
    contextWindowTokens: Math.max(...profiles.map((profile) => profile.contextWindowTokens ?? 0)) || undefined,
    maxOutputTokens: Math.max(...profiles.map((profile) => profile.maxOutputTokens ?? 0)) || undefined
  }
}

function mergeModelGroups(groups: readonly ModelProviderModelGroup[]): ModelProviderModelGroup[] {
  const byProvider = new Map<string, ModelProviderModelGroup>()
  for (const group of groups) {
    const providerId = group.providerId.trim()
    if (!providerId) continue
    const existing = byProvider.get(providerId)
    const modelIds = sortComposerModelIds([
      ...(existing?.modelIds ?? []),
      ...group.modelIds
    ])
    byProvider.set(providerId, {
      providerId,
      ...(group.presetSource ?? existing?.presetSource
        ? { presetSource: group.presetSource ?? existing?.presetSource }
        : {}),
      label: group.label.trim() || providerId,
      modelIds,
      modelProfiles: {
        ...(existing?.modelProfiles ?? {}),
        ...(group.modelProfiles ?? {})
      },
      ...(group.accountId ?? existing?.accountId
        ? { accountId: group.accountId ?? existing?.accountId }
        : {}),
      ...(group.extensionProvider ?? existing?.extensionProvider
        ? { extensionProvider: group.extensionProvider ?? existing?.extensionProvider }
        : {})
    })
  }
  return [...byProvider.values()].filter((group) => group.modelIds.length > 0)
}

function modelIdsFromProfiles(
  profiles: Record<string, unknown>,
  nonTextModelIds: readonly string[] = []
): string[] {
  const ids: string[] = []
  for (const [modelId, rawProfile] of Object.entries(profiles)) {
    const trimmed = modelId.trim()
    if (trimmed && isComposerChatModelId(trimmed, nonTextModelIds)) ids.push(trimmed)
    const aliases = objectValue(rawProfile).aliases
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (typeof alias !== 'string') continue
        const trimmedAlias = alias.trim()
        if (trimmedAlias && isComposerChatModelId(trimmedAlias, nonTextModelIds)) ids.push(trimmedAlias)
      }
    }
  }
  return ids
}

function mergeModelIds(ids: readonly string[]): string[] {
  return sortComposerModelIds([...DEFAULT_COMPOSER_MODEL_IDS, ...ids])
}

function hasCustomModelId(ids: readonly string[]): boolean {
  const defaults = new Set<string>(DEFAULT_COMPOSER_MODEL_IDS)
  return ids.some((id) => {
    const trimmed = id.trim()
    return trimmed !== '' && !defaults.has(trimmed as typeof DEFAULT_COMPOSER_MODEL_IDS[number])
  })
}

function sortComposerModelIds(ids: readonly string[]): string[] {
  const ordered = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed && trimmed !== 'auto') ordered.add(trimmed)
  }
  return [...ordered].sort((a, b) => a.localeCompare(b))
}

function expandHome(path: string): string {
  return path.startsWith('~') ? path.replace(/^~(?=$|[\\/])/, homedir()) : path
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === 'string' ? [item] : [])
    : []
}

function sharedServiceTiers(
  value: unknown
): NonNullable<ModelProviderModelProfileV1['serviceTiers']> {
  return [...new Set(stringValues(value).filter(
    (tier): tier is NonNullable<ModelProviderModelProfileV1['serviceTiers']>[number] =>
      tier === 'priority' || tier === 'flex'
  ))]
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined
}

function isModelEndpointFormat(
  value: unknown
): value is ModelProviderModelProfileV1['endpointFormat'] {
  return value === 'chat_completions' ||
    value === 'responses' ||
    value === 'messages' ||
    value === 'custom_endpoint'
}

function sharedReasoningProfile(
  value: unknown
): ModelProviderModelProfileV1['reasoning'] | undefined {
  const reasoning = objectValue(value)
  const supportedEfforts = stringValues(reasoning.supportedEfforts).filter((effort) =>
    effort === 'auto' ||
    effort === 'off' ||
    effort === 'low' ||
    effort === 'medium' ||
    effort === 'high' ||
    effort === 'max'
  ) as NonNullable<ModelProviderModelProfileV1['reasoning']>['supportedEfforts']
  const defaultEffort = reasoning.defaultEffort
  const requestProtocol = reasoning.requestProtocol
  if (
    supportedEfforts.length === 0 ||
    !supportedEfforts.includes(defaultEffort as never) ||
    (
      requestProtocol !== 'none' &&
      requestProtocol !== 'deepseek-chat-completions' &&
      requestProtocol !== 'glm-chat-completions' &&
      requestProtocol !== 'mimo-chat-completions' &&
      requestProtocol !== 'openai-chat-completions' &&
      requestProtocol !== 'qwen-chat-completions' &&
      requestProtocol !== 'thinking-toggle-chat-completions' &&
      requestProtocol !== 'openai-responses' &&
      requestProtocol !== 'anthropic-thinking'
    )
  ) return undefined
  return {
    supportedEfforts,
    defaultEffort: defaultEffort as NonNullable<ModelProviderModelProfileV1['reasoning']>['defaultEffort'],
    requestProtocol
  }
}
