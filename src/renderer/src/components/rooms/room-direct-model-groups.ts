import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { ComposerReasoningEffort } from '../chat/floating-composer-model-picker-logic'
import { modelProfileForModel, normalizeComposerReasoningEffort, reasoningOptionsForModel } from '../chat/floating-composer-model-picker-logic'
import type { AgentModels } from './AgentModelSettings'

export type DirectModelOption = AgentModels['options'][number]
export type DirectModelBinding = { providerId?: string; accountId?: string; model?: string }

/** Accounts sharing one provider id stay separate groups, so a pick always maps to one exact account. */
function groupKey(providerId: string, accountId: string | undefined, shared: boolean): string {
  return shared ? `${providerId}::${accountId ?? ''}` : providerId
}

/**
 * The Code composer's provider groups (labels, icons, model profiles),
 * narrowed to the models this Agent may run. Providers Code does not know
 * yet still appear, labelled by the runtime.
 */
export function directModelGroups(options: readonly DirectModelOption[], codeGroups: readonly ModelProviderModelGroup[]) {
  const usable = options.filter((option) => option.available && option.providerId)
  const accounts = new Map<string, Set<string>>()
  for (const option of usable) {
    const set = accounts.get(option.providerId!) ?? new Set<string>()
    set.add(option.accountId ?? '')
    accounts.set(option.providerId!, set)
  }
  const groups = new Map<string, ModelProviderModelGroup>()
  const providerOf = new Map<string, string>()
  const picks = new Map<string, DirectModelOption>()
  for (const option of usable) {
    const providerId = option.providerId!
    const shared = (accounts.get(providerId)?.size ?? 0) > 1
    const key = groupKey(providerId, option.accountId, shared)
    const code = codeGroups.find((group) => group.providerId === providerId)
    const group = groups.get(key) ?? { ...(code ?? {}), providerId: key, modelIds: [],
      label: [code?.label || option.providerLabel || providerId, shared ? option.accountId : ''].filter(Boolean).join(' · '),
      ...(option.accountId ? { accountId: option.accountId } : {}) }
    if (!group.modelIds.includes(option.model)) group.modelIds.push(option.model)
    groups.set(key, group)
    providerOf.set(key, providerId)
    picks.set(JSON.stringify([key, option.model]), option)
  }
  // Keep Code's model order within each provider.
  for (const [key, group] of groups) {
    const order = codeGroups.find((code) => code.providerId === providerOf.get(key))?.modelIds ?? []
    group.modelIds.sort((a, b) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity))
  }
  return {
    groups: [...groups.values()],
    pick: (key: string | undefined, model: string) => key ? picks.get(JSON.stringify([key, model])) : undefined,
    keyFor: (binding: DirectModelBinding | undefined) => binding?.providerId
      ? groupKey(binding.providerId, binding.accountId, (accounts.get(binding.providerId)?.size ?? 0) > 1) : undefined
  }
}

/** The effort the picker will show, so it never needs to "correct" an unset conversation by writing. */
export function directReasoningEffort(stored: string | undefined, group: ModelProviderModelGroup | undefined,
  model: string): ComposerReasoningEffort {
  const profile = modelProfileForModel(group, model)
  const options = reasoningOptionsForModel(profile)
  const normalized = normalizeComposerReasoningEffort(stored, profile)
  return options.some((option) => option.id === normalized) ? normalized : options[0]?.id ?? normalized
}
