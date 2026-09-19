import { useTranslation } from 'react-i18next'
import type { RoomMember } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import type { RoomPresetCatalog } from './rooms-client'

export function inheritedMemberModel(
  member: RoomMember,
  catalog: RoomPresetCatalog
) {
  const preset = catalog.presets.find((item) => item.id === member.presetId)
  return (
    member.modelRef ??
    (preset?.model
      ? {
          model: preset.model,
          providerId:
            preset.providerId ?? catalog.defaultModel?.providerId ?? ''
        }
      : catalog.defaultModel)
  )
}

export function RoomMemberModelSelect({
  member,
  catalog,
  disabled,
  className,
  selectClassName,
  onChange
}: {
  member: RoomMember
  catalog: RoomPresetCatalog
  disabled?: boolean
  className?: string
  selectClassName?: string
  onChange: (modelRef: RoomMember['modelRef']) => void
}) {
  const { t } = useTranslation('common')
  const groups = useChatStore((state) => state.composerModelGroups)
  const preset = catalog.presets.find((item) => item.id === member.presetId)
  const model = inheritedMemberModel(member, catalog)
  return (
    <label className={className}>
      {t('roomsMemberModel')}
      <select
        aria-label={t('roomsMemberModel')}
        className={selectClassName}
        disabled={disabled}
        value={member.modelRef ? JSON.stringify(member.modelRef) : ''}
        onChange={(event) =>
          onChange(
            event.target.value
              ? (JSON.parse(event.target.value) as RoomMember['modelRef'])
              : undefined
          )
        }
      >
        <option value="">
          {t('roomsInheritModel')} · {model?.providerId} / {model?.model}
        </option>
        {member.modelRef &&
        !groups.some(
          (group) =>
            group.providerId === member.modelRef?.providerId &&
            group.modelIds.includes(member.modelRef.model)
        ) ? (
          <option value={JSON.stringify(member.modelRef)}>
            {member.modelRef.providerId} / {member.modelRef.model}
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
      (!member.modelRef && preset?.available === false) ? (
        <p role="alert" className="rooms-member-model-warning text-xs text-amber-600">
          {preset?.reason ?? t('roomsSdkUnavailable')}
        </p>
      ) : null}
    </label>
  )
}
