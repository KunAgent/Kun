import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import { CURSOR_SDK_ADAPTIVE_REASONING } from '@shared/app-settings'
import type {
  ModelsDevCatalogModel,
  ModelsDevCatalogResult,
  ProviderModelCatalogSource
} from '@shared/kun-gui-api'
import {
  PROVIDER_MODEL_KINDS,
  classifyProviderModelIds,
  providerModelListEntries,
  type ProviderModelIdGroups,
  type ProviderModelKind
} from './provider-model-editor'

export type ProviderModelImportEntry = {
  modelId: string
  kind: ProviderModelKind
  sources: ProviderModelCatalogSource[]
  catalog?: ModelsDevCatalogModel
  alreadyExists: boolean
}

export type ProviderModelImportResult = ProviderModelIdGroups & {
  catalogModels: ModelsDevCatalogModel[]
}

export function providerModelImportEntryKey(
  kind: ProviderModelKind,
  modelId: string
): string {
  return `${kind}\u0001${modelId}`
}

export function buildProviderModelImportEntries(
  provider: ModelProviderProfileV1,
  providerModelIds: readonly string[],
  catalogResult: ModelsDevCatalogResult
): ProviderModelImportEntry[] {
  const catalogModels = catalogResult.status === 'ok' ? catalogResult.models : []
  const catalogById = new Map(
    catalogModels.map((model) => [modelKey(model.id), model] as const)
  )
  const rows = new Map<string, {
    modelId: string
    sources: ProviderModelCatalogSource[]
    catalog?: ModelsDevCatalogModel
  }>()

  for (const rawId of providerModelIds) {
    const modelId = rawId.trim()
    const key = modelKey(modelId)
    if (!key || rows.has(key)) continue
    const catalog = catalogById.get(key)
    rows.set(key, {
      modelId,
      sources: catalog ? ['provider-api', 'models-dev'] : ['provider-api'],
      ...(catalog ? { catalog } : {})
    })
  }

  if (catalogResult.status === 'ok' && catalogResult.matchMode === 'catalog') {
    for (const catalog of catalogModels) {
      const key = modelKey(catalog.id)
      if (!key || rows.has(key)) continue
      rows.set(key, {
        modelId: catalog.id.trim(),
        sources: ['models-dev'],
        catalog
      })
    }
  }

  const existing = existingKeysFor(provider)
  return [...rows.values()].map((row) => {
    const kind = classifyImportModel(provider, row.modelId, row.catalog)
    return {
      ...row,
      kind,
      alreadyExists: existing.has(providerModelImportEntryKey(kind, modelKey(row.modelId)))
    }
  })
}

export function defaultSelectedProviderModelImportKeys(
  entries: readonly ProviderModelImportEntry[],
  includeExisting = false
): Set<string> {
  const selected = new Set<string>()
  for (const entry of entries) {
    if ((includeExisting || !entry.alreadyExists) && entry.sources.includes('provider-api')) {
      selected.add(providerModelImportEntryKey(entry.kind, entry.modelId))
    }
  }
  return selected
}

export function providerModelImportEntryCanEnrich(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  entry: ProviderModelImportEntry
): boolean {
  if (!entry.alreadyExists || entry.kind !== 'chat' || !entry.catalog) return false
  const normalizedId = modelKey(entry.modelId)
  const existingKey = Object.keys(provider.modelProfiles)
    .find((key) => modelKey(key) === normalizedId)
  if (!existingKey) return true
  const existing = provider.modelProfiles[existingKey]
  return (
    (entry.catalog.contextWindowTokens !== undefined &&
      existing.contextWindowTokens !== entry.catalog.contextWindowTokens) ||
    (entry.catalog.maxOutputTokens !== undefined &&
      existing.maxOutputTokens !== entry.catalog.maxOutputTokens) ||
    (entry.catalog.pricing !== undefined &&
      JSON.stringify(existing.pricing) !== JSON.stringify(entry.catalog.pricing))
  )
}

export function providerModelImportResult(
  entries: readonly ProviderModelImportEntry[],
  selected: ReadonlySet<string>
): ProviderModelImportResult {
  const result: ProviderModelImportResult = {
    chat: [],
    image: [],
    speech: [],
    tts: [],
    music: [],
    video: [],
    catalogModels: []
  }
  const catalogKeys = new Set<string>()
  for (const entry of entries) {
    const isSelected = selected.has(providerModelImportEntryKey(entry.kind, entry.modelId))
    if (isSelected) result[entry.kind].push(entry.modelId)
    if ((isSelected || entry.alreadyExists) && entry.catalog && !catalogKeys.has(modelKey(entry.catalog.id))) {
      catalogKeys.add(modelKey(entry.catalog.id))
      result.catalogModels.push(entry.catalog)
    }
  }
  return result
}

export function mergeProviderModelIdsCaseInsensitive(
  primary: readonly string[],
  secondary: readonly string[]
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const rawId of [...primary, ...secondary]) {
    const modelId = rawId.trim()
    const key = modelKey(modelId)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(modelId)
  }
  return merged
}

export function enrichProviderModelProfiles(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  selectedChatModelIds: readonly string[],
  catalogModels: readonly ModelsDevCatalogModel[],
  discoveredAliases: Readonly<Record<string, readonly string[]>> = {}
): Record<string, ModelProviderModelProfileV1> {
  const catalogById = new Map(catalogModels.map((model) => [modelKey(model.id), model] as const))
  const aliasesById = new Map(
    Object.entries(discoveredAliases)
      .map(([modelId, aliases]) => [modelKey(modelId), normalizeAliases(aliases)] as const)
      .filter(([modelId]) => Boolean(modelId))
  )
  const profileKeyById = new Map(
    Object.keys(provider.modelProfiles).map((key) => [modelKey(key), key] as const)
  )
  let next = provider.modelProfiles

  for (const rawModelId of selectedChatModelIds) {
    const normalizedId = modelKey(rawModelId)
    const catalog = catalogById.get(normalizedId)
    const aliases = aliasesById.get(normalizedId) ?? []
    if (!catalog && aliases.length === 0) continue
    const existingKey = profileKeyById.get(normalizedId)
    if (!existingKey) {
      if (!catalog) continue
      if (next === provider.modelProfiles) next = { ...provider.modelProfiles }
      const key = normalizedId
      next[key] = {
        ...modelProfileFromCatalog(catalog),
        ...(aliases.length ? { aliases } : {})
      }
      profileKeyById.set(normalizedId, key)
      continue
    }

    const existing = next[existingKey]
    const addContext = catalog?.contextWindowTokens !== undefined &&
      existing.contextWindowTokens !== catalog.contextWindowTokens
    const addOutput = catalog?.maxOutputTokens !== undefined &&
      existing.maxOutputTokens !== catalog.maxOutputTokens
    const addPricing = catalog?.pricing !== undefined &&
      JSON.stringify(existing.pricing) !== JSON.stringify(catalog.pricing)
    const mergedAliases = normalizeAliases([...(existing.aliases ?? []), ...aliases])
    const addAliases = mergedAliases.length !== (existing.aliases?.length ?? 0)
    if (!addContext && !addOutput && !addPricing && !addAliases) continue
    if (next === provider.modelProfiles) next = { ...provider.modelProfiles }
    next[existingKey] = {
      ...existing,
      ...(mergedAliases.length ? { aliases: mergedAliases } : {}),
      ...(addContext
        ? { contextWindowTokens: catalog?.contextWindowTokens }
        : {}),
      ...(addOutput
        ? { maxOutputTokens: catalog?.maxOutputTokens }
        : {}),
      ...(addPricing && catalog ? { pricing: { ...catalog.pricing! } } : {})
    }
  }

  return next
}

export function enrichCursorProviderModelProfiles(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  selectedChatModelIds: readonly string[],
  catalogModels: readonly ModelsDevCatalogModel[],
  discoveredAliases: Readonly<Record<string, readonly string[]>> = {}
): Record<string, ModelProviderModelProfileV1> {
  const enriched = enrichProviderModelProfiles(
    provider,
    selectedChatModelIds,
    catalogModels,
    discoveredAliases
  )
  const profileKeyById = new Map(
    Object.keys(enriched).map((key) => [modelKey(key), key] as const)
  )
  let next = enriched

  for (const rawModelId of selectedChatModelIds) {
    const normalizedId = modelKey(rawModelId)
    if (!normalizedId) continue
    const existingKey = profileKeyById.get(normalizedId)
    const existing = existingKey ? next[existingKey] : undefined
    if (existing?.reasoning) continue
    if (next === enriched) next = { ...enriched }
    const key = existingKey ?? normalizedId
    next[key] = existing
      ? {
          ...existing,
          reasoning: { ...CURSOR_SDK_ADAPTIVE_REASONING }
        }
      : {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text'],
          reasoning: { ...CURSOR_SDK_ADAPTIVE_REASONING }
        }
    profileKeyById.set(normalizedId, key)
  }

  return next
}

function normalizeAliases(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const raw of values ?? []) {
    const alias = raw.trim()
    const key = modelKey(alias)
    if (!key || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }
  return aliases
}

export function modelProfileFromCatalog(
  catalog: ModelsDevCatalogModel
): ModelProviderModelProfileV1 {
  const supportsImageInput = catalog.inputModalities.includes('image')
  const supportsImageOutput = catalog.outputModalities.includes('image')
  return {
    ...(catalog.contextWindowTokens
      ? { contextWindowTokens: catalog.contextWindowTokens }
      : {}),
    ...(catalog.maxOutputTokens
      ? { maxOutputTokens: catalog.maxOutputTokens }
      : {}),
    inputModalities: supportsImageInput ? ['text', 'image'] : ['text'],
    outputModalities: supportsImageOutput ? ['text', 'image'] : ['text'],
    supportsToolCalling: catalog.toolCalling ?? true,
    messageParts: supportsImageInput ? ['text', 'image_url'] : ['text'],
    ...(catalog.reasoning === true ? { reasoning: catalogReasoningProfile() } : {}),
    ...(catalog.pricing ? { pricing: { ...catalog.pricing } } : {})
  }
}

function catalogReasoningProfile(): NonNullable<ModelProviderModelProfileV1['reasoning']> {
  return {
    supportedEfforts: ['auto'],
    defaultEffort: 'auto',
    requestProtocol: 'none'
  }
}

function classifyImportModel(
  provider: ModelProviderProfileV1,
  modelId: string,
  catalog?: ModelsDevCatalogModel
): ProviderModelKind {
  const catalogKind = catalogModelKind(provider, modelId, catalog)
  if (catalogKind) return catalogKind

  const existingKind = providerModelListEntries(provider)
    .find((entry) => modelKey(entry.modelId) === modelKey(modelId))?.kind
  if (existingKind) return existingKind

  return heuristicModelKind(provider, modelId) ?? 'chat'
}

function catalogModelKind(
  provider: ModelProviderProfileV1,
  modelId: string,
  catalog?: ModelsDevCatalogModel
): ProviderModelKind | undefined {
  if (!catalog) return undefined
  if (catalog.outputModalities.includes('video')) return 'video'
  if (catalog.outputModalities.includes('image')) return 'image'
  if (catalog.outputModalities.includes('audio')) {
    const heuristic = heuristicModelKind(provider, modelId)
    return heuristic === 'music' ? 'music' : 'tts'
  }
  // Catalog modalities are capabilities, not endpoint roles. A model that accepts
  // and returns text remains chat-capable even when it also accepts audio input.
  if (
    catalog.inputModalities.includes('text') &&
    catalog.outputModalities.includes('text')
  ) return 'chat'
  if (
    catalog.inputModalities.includes('audio') &&
    catalog.outputModalities.includes('text')
  ) return 'speech'
  return undefined
}

function heuristicModelKind(
  provider: ModelProviderProfileV1,
  modelId: string
): ProviderModelKind | undefined {
  const groups = classifyProviderModelIds(provider, [modelId])
  return PROVIDER_MODEL_KINDS.find((kind) => groups[kind].length > 0)
}

function existingKeysFor(provider: ModelProviderProfileV1): Set<string> {
  const existing = new Set<string>()
  for (const { kind, modelId } of providerModelListEntries(provider)) {
    existing.add(providerModelImportEntryKey(kind, modelKey(modelId)))
  }
  return existing
}

function modelKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}
