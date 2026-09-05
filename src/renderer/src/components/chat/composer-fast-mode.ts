import type { ModelProviderProfileV1 } from '@shared/app-settings'
import { modelProviderModelProfile } from '@shared/app-settings-provider-core'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

export const CODEX_FAST_SERVICE_TIER = 'priority' as const

export function modelProviderIsCodex(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource'> | undefined
): boolean {
  return Boolean(provider && isCodexProvider(provider.id, provider.presetSource?.presetId))
}

export function modelProviderSupportsCodexFastMode(
  provider: Pick<ModelProviderProfileV1, 'id' | 'presetSource' | 'modelProfiles'> | undefined,
  modelId: string
): boolean {
  const model = normalizeModelId(modelId)
  if (!provider || !model || !modelProviderIsCodex(provider)) return false
  const profile = modelProviderModelProfile(provider, model) ?? Object.values(provider.modelProfiles)
    .find((candidate) => candidate.aliases?.some((alias) => normalizeModelId(alias) === model))
  return profile?.serviceTiers?.includes(CODEX_FAST_SERVICE_TIER) === true
}

export function composerSupportsCodexFastMode(
  groups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId: string
): boolean {
  const provider = providerId.trim()
  const model = normalizeModelId(modelId)
  if (!provider || !model) return false
  const group = groups.find((candidate) => candidate.providerId === provider)
  if (!group) return false
  const presetSource = group.presetSource?.trim().toLowerCase()
  if (!isCodexProvider(provider, presetSource)) {
    return false
  }
  const profile = Object.entries(group.modelProfiles ?? {}).find(([candidate, value]) =>
    normalizeModelId(candidate) === model ||
    value.aliases?.some((alias) => normalizeModelId(alias) === model)
  )?.[1]
  return profile?.serviceTiers?.includes(CODEX_FAST_SERVICE_TIER) === true
}

export function serviceTierForComposerSelection(
  enabled: boolean,
  groups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId: string
): typeof CODEX_FAST_SERVICE_TIER | undefined {
  return enabled && composerSupportsCodexFastMode(groups, modelId, providerId)
    ? CODEX_FAST_SERVICE_TIER
    : undefined
}

function isCodexProvider(providerId: string, presetSource: string | undefined): boolean {
  return presetSource === 'codex' || (presetSource === undefined && providerId.trim().toLowerCase() === 'codex')
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase()
}
