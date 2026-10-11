import { resolveProviderIconKey } from '../provider-icon'
import type { ComposerModelMenuGroup } from './floating-composer-model-picker-logic'

/**
 * Agents that route to several model providers (OpenCode, OpenCode2,
 * CodeMaker, Pi) name each model `<provider>/<model>`, both in the id
 * (`opencode/big-pickle`) and in the display name (`OpenCode Zen/Big
 * Pickle`). The picker shows one section per provider and the model's own
 * name inside it instead of repeating the provider on every row.
 */
export type ProviderModelSection = { key: string; label: string; modelIds: string[] }

/** Provider and short model name of a provider-qualified model, if it is one. */
export function providerQualifiedModel(id: string, displayName?: string): { key: string; provider: string; model: string } | undefined {
  const cut = id.indexOf('/')
  if (cut <= 0 || cut === id.length - 1) return undefined
  const key = id.slice(0, cut)
  const named = displayName?.trim() ?? ''
  const nameCut = named.indexOf('/')
  return nameCut > 0 && nameCut < named.length - 1
    ? { key, provider: named.slice(0, nameCut).trim(), model: named.slice(nameCut + 1).trim() }
    : { key, provider: key, model: named || id.slice(cut + 1) }
}

/**
 * Sections for a native catalog whose every model is provider-qualified and
 * that spans at least two providers; undefined keeps the flat list. Order
 * follows the Agent's own list.
 */
export function providerModelSections(
  group: Pick<ComposerModelMenuGroup, 'nativeHarnessId' | 'modelInfo'>,
  modelIds: readonly string[]
): ProviderModelSection[] | undefined {
  if (!group.nativeHarnessId || group.nativeHarnessId === 'devin' || modelIds.length === 0) return undefined
  const sections = new Map<string, ProviderModelSection>()
  for (const id of modelIds) {
    const parts = providerQualifiedModel(id, group.modelInfo?.[id]?.displayName)
    if (!parts) return undefined
    const section = sections.get(parts.key) ?? { key: parts.key, label: parts.provider, modelIds: [] }
    section.modelIds.push(id)
    sections.set(parts.key, section)
  }
  return sections.size >= 2 ? [...sections.values()] : undefined
}

/** Short name for a row inside its provider section. */
export function providerSectionModelName(group: Pick<ComposerModelMenuGroup, 'modelInfo'>, id: string): string {
  return providerQualifiedModel(id, group.modelInfo?.[id]?.displayName)?.model ?? group.modelInfo?.[id]?.displayName ?? id
}

/** Sections open at first: all for short lists, else the one holding the current model (or the first). */
export function initialOpenProviderSections(sections: readonly ProviderModelSection[], currentModel: string, expandAllAt: number): Set<string> {
  const total = sections.reduce((sum, section) => sum + section.modelIds.length, 0)
  if (total <= expandAllAt) return new Set(sections.map((section) => section.key))
  const current = sections.find((section) => section.modelIds.includes(currentModel)) ?? sections[0]
  return new Set(current ? [current.key] : [])
}

// models.dev provider ids (OpenCode's catalog) mapped to Kun's provider presets.
const PRESET_FOR_PROVIDER: Readonly<Record<string, string>> = {
  openai: 'openai-api', anthropic: 'anthropic-api', google: 'gemini-api', xai: 'xai-api', mistral: 'mistral-api',
  zhipuai: 'zhipu-api', moonshotai: 'moonshot-global', opencode: 'opencode-zen'
}

/** Preset whose mark represents this provider; undefined when Kun has none (never Kun's own mark). */
export function providerSectionIconPreset(key: string): string | undefined {
  const preset = Object.prototype.hasOwnProperty.call(PRESET_FOR_PROVIDER, key) ? PRESET_FOR_PROVIDER[key]! : key
  return resolveProviderIconKey({ presetId: preset, providerId: key }) === 'kun' ? undefined : preset
}
