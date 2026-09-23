import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

/**
 * Provider-grouped model picker for mobile sheets. Falls back to a flat list
 * of ids when the host did not send groups yet.
 */
export function MobileModelSelect({ value, groups, fallbackIds, autoLabel, onChange }: {
  value: string
  groups: ModelProviderModelGroup[]
  fallbackIds: string[]
  autoLabel: string
  onChange: (model: string, providerId: string) => void
}): React.JSX.Element {
  const providerForModel = (model: string): string =>
    groups.find((group) => group.modelIds.includes(model))?.providerId ?? ''
  const optionLabel = (group: ModelProviderModelGroup, modelId: string): string =>
    group.modelProfiles?.[modelId]?.aliases?.[0] ?? modelId

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value, providerForModel(event.target.value))}
    >
      {!value ? <option value="">{autoLabel}</option> : null}
      {groups.length > 0
        ? groups.map((group) => (
          <optgroup key={group.providerId} label={group.label || group.providerId}>
            {group.modelIds.map((modelId) => (
              <option key={modelId} value={modelId}>{optionLabel(group, modelId)}</option>
            ))}
          </optgroup>
        ))
        : fallbackIds.map((modelId) => (
          <option key={modelId} value={modelId}>{modelId}</option>
        ))}
      {/* Keep a selected-but-unlisted model visible so the select is never blank. */}
      {value && !groups.some((group) => group.modelIds.includes(value))
        && !fallbackIds.includes(value)
        ? <option value={value}>{value}</option>
        : null}
    </select>
  )
}
