import { useTranslation } from 'react-i18next'
import type { RoomMember } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import type { RoomPresetCatalog } from './rooms-client'

export function inheritedMemberModel(
  member: Pick<RoomMember, 'presetId'>,
  catalog: RoomPresetCatalog
): RoomMember['modelRef'] {
  const preset = catalog.presets.find((item) => item.id === member.presetId)
  if (preset?.model) {
    return {
      model: preset.model,
      providerId: preset.providerId ?? catalog.defaultModel?.providerId ?? ''
    }
  }
  const fallback = catalog.defaultModel
  return fallback?.model
    ? { model: fallback.model, providerId: fallback.providerId ?? '' }
    : undefined
}

export function RoomMemberModelSelect({
  member,
  catalog,
  modelRef,
  inherited,
  disabled,
  className,
  selectClassName,
  onChange
}: {
  member: RoomMember
  catalog: RoomPresetCatalog
  modelRef?: RoomMember['modelRef']
  inherited?: RoomMember['modelRef']
  disabled?: boolean
  className?: string
  selectClassName?: string
  onChange: (modelRef: RoomMember['modelRef']) => void
}) {
  const { t } = useTranslation('common')
  const groups = useChatStore((state) => state.composerModelGroups)
  const preset = catalog.presets.find((item) => item.id === member.presetId)
  const selected = modelRef
  const inheritedModel = inherited ?? inheritedMemberModel(member, catalog)
  const model = selected ?? inheritedModel
  return (
    <label className={className}>
      {t('roomsMemberModel')}
      <select
        aria-label={t('roomsMemberModel')}
        className={selectClassName}
        disabled={disabled}
        value={selected ? JSON.stringify(selected) : ''}
        onChange={(event) =>
          onChange(
            event.target.value
              ? (JSON.parse(event.target.value) as RoomMember['modelRef'])
              : undefined
          )
        }
      >
        <option value="">
          {t('roomsInheritModel')} · {inheritedModel?.providerId} / {inheritedModel?.model}
        </option>
        {selected &&
        !groups.some(
          (group) =>
            group.providerId === selected.providerId &&
            group.modelIds.includes(selected.model)
        ) ? (
          <option value={JSON.stringify(selected)}>
            {selected.providerId} / {selected.model}
          </option>
        ) : null}
        {groups.map((group) => (
          <optgroup key={group.providerId} label={group.label}>
            {group.modelIds.map((id) => (
              <option
                key={id}
                disabled={catalog.unsupportedProviderIds?.includes(
                  group.providerId
                )}
                value={JSON.stringify({
                  providerId: group.providerId,
                  model: id,
                  ...(group.accountId ? { accountId: group.accountId } : {})
                })}
              >
                {id}
                {catalog.unsupportedProviderIds?.includes(group.providerId)
                  ? ` · ${t('roomsSdkUnavailable')}`
                  : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {(model?.providerId &&
        catalog.unsupportedProviderIds?.includes(model.providerId)) ||
      (!selected && preset?.available === false) ? (
        <p role="alert" className="rooms-member-model-warning text-xs text-amber-600">
          {preset?.reason ?? t('roomsSdkUnavailable')}
        </p>
      ) : null}
    </label>
  )
}
