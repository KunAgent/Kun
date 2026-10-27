import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  LEGACY_REASONING_EFFORTS,
  REASONING_OPTIONS,
  agentModelReasoningChoices,
  modelProfileForModel,
  reasoningOptionsForModel
} from '../components/chat/floating-composer-model-picker-logic'

/**
 * Reasoning levels a plan build can request for one model, `auto` first.
 * An external Agent that did not describe the model gets every level (Kun
 * forwards the pick through the Agent's own option); one that described it
 * without levels gets none. An empty list hides the control.
 */
export function planBuildEffortChoices(
  group: Pick<ModelProviderModelGroup, 'modelProfiles'> | undefined,
  model: string,
  external: boolean,
  /** The Agent's own catalog entry, the same source the composer reads. */
  nativeInfo?: { reasoningEfforts?: readonly string[] }
): string[] {
  if (!model.trim()) return []
  const profile = modelProfileForModel(group, model)
  const levels: string[] = nativeInfo ? agentModelReasoningChoices(nativeInfo)
    : external ? profile ? (profile.reasoning?.supportedEfforts ?? []) : LEGACY_REASONING_EFFORTS
      : reasoningOptionsForModel(profile).map((option) => option.id)
  const ordered = REASONING_OPTIONS.map((option) => option.id as string)
    .filter((id) => id !== 'auto' && levels.includes(id))
  return ordered.length ? ['auto', ...ordered] : []
}

export function planBuildEffortLabelKey(effort: string): string {
  return REASONING_OPTIONS.find((option) => option.id === effort)?.labelKey ?? 'composerReasoningAuto'
}
