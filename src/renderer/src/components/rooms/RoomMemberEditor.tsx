import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomMember } from '@shared/rooms-api'
import type { RoomPresetCatalog, RoomRepositoryInput } from './rooms-client'
import { roomButtonClass, roomFieldClass } from './RoomSettings'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarPicker } from './RoomAvatarPicker'
import { RoomMemberModelSelect } from './RoomMemberModelSelect'

const words = (value: string) =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

function CapabilityListInput({
  label,
  values,
  onChange
}: {
  label: string
  values: string[] | undefined
  onChange: (values: string[]) => void
}) {
  const serialized = values?.join(', ') ?? ''
  const [draft, setDraft] = useState(serialized)
  useEffect(() => setDraft(serialized), [serialized])
  return (
    <label className="block">
      {label}
      <input
        className={roomFieldClass}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(words(draft))}
      />
    </label>
  )
}

export function RoomMemberEditor({
  member,
  members,
  repositories,
  catalog,
  defaultMemberId,
  hasActiveTasks,
  onChange,
  onRemove,
  onCopy
}: {
  member: RoomMember
  members: RoomMember[]
  repositories: RoomRepositoryInput[]
  catalog: RoomPresetCatalog
  defaultMemberId: string
  hasActiveTasks: boolean
  onChange: (patch: Partial<RoomMember>) => void
  onRemove: () => void
  onCopy: () => void
}) {
  const { t } = useTranslation('common')
  const preset = catalog.presets.find((item) => item.id === member.presetId)
  const overrides = member.capabilityOverrides
  const updateCapabilities = (
    patch: Partial<NonNullable<RoomMember['capabilityOverrides']>>
  ) =>
    onChange({
      capabilityOverrides: {
        blockedTools: [],
        blockedSkills: [],
        blockedMcpServers: [],
        ...overrides,
        ...patch
      }
    })
  return (
    <fieldset className="space-y-3 rounded-xl border border-ds-border p-3">
      <legend className="px-1 text-sm text-ds-muted">
        {member.displayName}
      </legend>
      {member.participantAgentId ? <><RoomAvatar member={member} label={member.displayName} size={48} />
        <p className="rooms-run-note">{t('agentsMembershipHint')}</p></> : <RoomAvatarPicker member={member} onChange={(avatar) => onChange({ avatar })} />}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-ds-muted">
          {t('roomsMemberName')}
          <input
            required
            maxLength={80}
            className={roomFieldClass}
            disabled={Boolean(member.participantAgentId)}
            value={member.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
        </label>
        <label className="text-xs text-ds-muted">
          {t('roomsRole')}
          <select
            className={roomFieldClass}
            value={member.role}
            onChange={(event) =>
              onChange({ role: event.target.value as RoomMember['role'] })
            }
          >
            {(
              ['coordinator', 'developer', 'reviewer', 'diagnostician'] as const
            ).map((role) => (
              <option key={role} value={role}>
                {t(`rooms${role[0].toUpperCase()}${role.slice(1)}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-xs text-ds-muted">
        {t('roomsProfile')}
        <select
          className={roomFieldClass}
          disabled={Boolean(member.participantAgentId)}
          value={member.presetId}
          onChange={(event) => onChange({ presetId: event.target.value })}
        >
          {!catalog.presets.some((item) => item.id === member.presetId) ? (
            <option value={member.presetId}>{member.presetId}</option>
          ) : null}
          {catalog.presets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.available === false ? ` · ${t('roomsUnavailable')}` : ''}
            </option>
          ))}
        </select>
      </label>
      <RoomMemberModelSelect
        member={member}
        catalog={catalog}
        className="block text-xs text-ds-muted"
        selectClassName={roomFieldClass}
        onChange={(modelRef) => onChange({ modelRef })}
      />
      <label className="block text-xs text-ds-muted">
        {t('roomsRoleNotes')}
        <textarea
          maxLength={8000}
          rows={2}
          className={roomFieldClass}
          value={member.roleNotes}
          onChange={(event) => onChange({ roleNotes: event.target.value })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ds-muted">
        <input
          type="checkbox"
          checked={member.enabled}
          disabled={member.id === defaultMemberId}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        {t('roomsEnabled')}
      </label>
      <div className="text-xs text-ds-muted">
        {t('roomsAllowedRepositories')}
      </div>
      <div className="flex flex-wrap gap-3">
        {repositories.map((repository) =>
          repository.id ? (
            <label
              key={repository.id}
              className="flex items-center gap-2 text-sm text-ds-muted"
            >
              <input
                type="checkbox"
                checked={member.allowedRepositoryIds.includes(repository.id)}
                onChange={(event) => {
                  const id = repository.id!
                  onChange({
                    allowedRepositoryIds: event.target.checked
                      ? [...member.allowedRepositoryIds, id]
                      : member.allowedRepositoryIds.filter(
                          (value) => value !== id
                        ),
                    ...(!event.target.checked &&
                    member.defaultRepositoryId === id
                      ? { defaultRepositoryId: undefined }
                      : {})
                  })
                }}
              />
              {repository.displayName}
            </label>
          ) : null
        )}
      </div>
      <label className="block text-xs text-ds-muted">
        {t('roomsDefaultRepository')}
        <select
          className={roomFieldClass}
          value={member.defaultRepositoryId ?? ''}
          onChange={(event) =>
            onChange({ defaultRepositoryId: event.target.value || undefined })
          }
        >
          <option value="">{t('roomsNone')}</option>
          {repositories
            .filter(
              (repo) => repo.id && member.allowedRepositoryIds.includes(repo.id)
            )
            .map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.displayName}
              </option>
            ))}
        </select>
      </label>
      <label className="block text-xs text-ds-muted">
        {t('roomsReviewBy')}
        <select
          className={roomFieldClass}
          value={member.reviewPolicy?.reviewerMemberId ?? ''}
          onChange={(event) =>
            onChange({
              reviewPolicy: event.target.value
                ? {
                    reviewerMemberId: event.target.value,
                    allowAutomaticRework: false,
                    maxReworkRounds: 2
                  }
                : undefined
            })
          }
        >
          <option value="">{t('roomsNoReview')}</option>
          {members
            .filter(
              (other) =>
                other.id !== member.id && other.enabled && !other.removedAt
            )
            .map((other) => (
              <option key={other.id} value={other.id}>
                {other.displayName}
              </option>
            ))}
        </select>
      </label>
      {member.reviewPolicy ? (
        <label className="flex items-center gap-2 text-sm text-ds-muted">
          <input
            type="checkbox"
            checked={member.reviewPolicy.allowAutomaticRework}
            onChange={(event) =>
              onChange({
                reviewPolicy: {
                  ...member.reviewPolicy!,
                  allowAutomaticRework: event.target.checked
                }
              })
            }
          />
          {t('roomsRework')}
        </label>
      ) : null}
      <details className="space-y-2 text-xs text-ds-muted">
        <summary>{t('roomsCapabilities')}</summary>
        <p>{t('roomsCapabilitiesHint')}</p>
        <p>
          {t('roomsInheritedCapabilities')}: {preset?.toolPolicy ?? 'inherit'} ·
          Skills{' '}
          {preset?.skillsEnabled === false
            ? t('roomsDisabled')
            : t('roomsEnabled')}
        </p>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap">
          {JSON.stringify(
            {
              allowedTools: preset?.allowedTools,
              blockedTools: preset?.blockedTools,
              blockedMcpServers: preset?.blockedMcpServers,
              blockedSkills: preset?.blockedSkills
            },
            null,
            2
          )}
        </pre>
        <CapabilityListInput
          label={t('roomsAllowedTools')}
          values={overrides?.allowedTools}
          onChange={(values) =>
            updateCapabilities({
              allowedTools: values.length ? values : undefined
            })
          }
        />
        {(['blockedTools', 'blockedMcpServers', 'blockedSkills'] as const).map(
          (key) => (
            <CapabilityListInput
              key={key}
              label={t(`rooms_${key}`)}
              values={overrides?.[key]}
              onChange={(values) => updateCapabilities({ [key]: values })}
            />
          )
        )}
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={overrides?.skillsEnabled === false}
            onChange={(event) =>
              updateCapabilities({
                skillsEnabled: event.target.checked ? false : undefined
              })
            }
          />
          {t('roomsDisableSkills')}
        </label>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={roomButtonClass} onClick={onCopy}>
          {t('roomsCopyMember')}
        </button>
        <button
          type="button"
          className={roomButtonClass}
          disabled={hasActiveTasks || member.id === defaultMemberId}
          onClick={onRemove}
        >
          {t('roomsRemove')}
        </button>
        {hasActiveTasks ? (
          <span className="text-xs text-ds-muted">
            {t('roomsDisableFirst')}
          </span>
        ) : null}
      </div>
    </fieldset>
  )
}
