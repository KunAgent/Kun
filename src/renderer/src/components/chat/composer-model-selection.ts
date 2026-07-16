import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import { providerIdForComposerModel } from '../../store/chat-store-helpers'

export type ExtensionModelCatalogEntry = {
  providerId: string
  modelId: string
  label: string
  capabilities: {
    input: Array<'text' | 'image' | 'video'>
    contextWindowTokens: number
  }
}

export function buildExtensionModelGroups(
  entries: readonly ExtensionModelCatalogEntry[]
): ModelProviderModelGroup[] {
  const grouped = new Map<string, ExtensionModelCatalogEntry[]>()
  for (const entry of entries) {
    const current = grouped.get(entry.providerId) ?? []
    current.push(entry)
    grouped.set(entry.providerId, current)
  }
  return [...grouped].map(([providerId, models]) => ({
    providerId,
    label: providerId === 'moa' ? 'MoA 多模型融合' : providerId,
    modelIds: models.map((model) => model.modelId),
    modelProfiles: Object.fromEntries(models.map((model) => [model.modelId, {
      inputModalities: model.capabilities.input.includes('image') ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: model.capabilities.input.includes('image')
        ? ['text', 'image_url', 'input_image']
        : ['text'],
      contextWindowTokens: model.capabilities.contextWindowTokens
    }]))
  }))
}

function normalizeModelKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function addSelectableModel(ids: Set<string>, modelId: string): void {
  const normalized = modelId.trim()
  if (normalized && normalized.toLowerCase() !== 'auto') ids.add(normalized)
}

export function buildComposerAssistantPickList(input: {
  composerPickList: readonly string[]
  defaultModelIds?: readonly string[]
}): string[] {
  const ordered = new Set<string>()
  for (const id of input.defaultModelIds ?? DEFAULT_COMPOSER_MODEL_IDS) {
    addSelectableModel(ordered, id)
  }
  for (const id of input.composerPickList) {
    addSelectableModel(ordered, id)
  }
  return [...ordered]
}

export function resolveComposerAssistantProviderId(input: {
  composerModelGroups: readonly ModelProviderModelGroup[]
  model: string
  storedProviderId: string
}): string {
  const stored = input.storedProviderId.trim()
  if (stored) {
    const group = input.composerModelGroups.find((item) => item.providerId === stored)
    const modelKey = normalizeModelKey(input.model)
    const storedMatchesModel =
      !modelKey ||
      group?.modelIds.some((modelId) => normalizeModelKey(modelId) === modelKey) === true
    if (group && storedMatchesModel) return stored
  }
  return providerIdForComposerModel(input.composerModelGroups, input.model)
}
