import {
  DEFAULT_CLAW_MODEL,
  listModelProviderModelIds,
  type AppSettingsV1
} from '@shared/app-settings'

export function mergeClawModelOptions(
  modelIds: readonly string[],
  currentModel = ''
): string[] {
  const options = new Set<string>([DEFAULT_CLAW_MODEL])
  for (const modelId of modelIds) {
    const trimmed = modelId.trim()
    if (trimmed && trimmed !== DEFAULT_CLAW_MODEL) options.add(trimmed)
  }
  const current = currentModel.trim()
  if (current && current !== DEFAULT_CLAW_MODEL) options.add(current)
  return [...options]
}

export function clawModelSelectOptions(
  settings: AppSettingsV1,
  currentModel = ''
): string[] {
  return mergeClawModelOptions(listModelProviderModelIds(settings), currentModel)
}
