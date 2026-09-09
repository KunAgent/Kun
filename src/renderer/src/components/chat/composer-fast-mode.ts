import type { ModelProviderModelProfileV1, ModelProviderProfileV1 } from '@shared/app-settings'
import { modelProviderModelProfile } from '@shared/app-settings-provider-core'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

export const CODEX_FAST_SERVICE_TIER = 'priority' as const

/**
 * `hidden` keeps non-Codex composers unchanged, `supported` allows the toggle,
 * `unsupported` means the provider declared tiers without priority, and
 * `unknown` means the provider never declared tiers for this model.
 */
export type ComposerFastModeState = 'hidden' | 'supported' | 'unknown' | 'unsupported'

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
  return modelProviderProfileForModel(provider, model)?.serviceTiers
    ?.includes(CODEX_FAST_SERVICE_TIER) === true
}

export function composerFastModeState(
  groups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId: string
): ComposerFastModeState {
  const provider = providerId.trim()
  const model = normalizeModelId(modelId)
  if (!provider || !model) return 'hidden'
  const group = groups.find((candidate) => candidate.providerId === provider)
  if (!group) return 'hidden'
  const presetSource = group.presetSource?.trim().toLowerCase()
  if (!isCodexProvider(provider, presetSource)) return 'hidden'
  const serviceTiers = composerModelProfile(group, model)?.serviceTiers
  if (!serviceTiers) return 'unknown'
  return serviceTiers.includes(CODEX_FAST_SERVICE_TIER) ? 'supported' : 'unsupported'
}

export function composerSupportsCodexFastMode(
  groups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId: string
): boolean {
  return composerFastModeState(groups, modelId, providerId) === 'supported'
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

function modelProviderProfileForModel(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'>,
  model: string
): ModelProviderModelProfileV1 | undefined {
  return modelProviderModelProfile(provider, model) ?? Object.values(provider.modelProfiles)
    .find((candidate) => candidate.aliases?.some((alias) => normalizeModelId(alias) === model))
}

function composerModelProfile(
  group: ModelProviderModelGroup,
  model: string
): ModelProviderModelProfileV1 | undefined {
  return Object.entries(group.modelProfiles ?? {}).find(([candidate, value]) =>
    normalizeModelId(candidate) === model ||
    value.aliases?.some((alias) => normalizeModelId(alias) === model)
  )?.[1]
}
