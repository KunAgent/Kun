import { roomsRequest } from './rooms-client'
import { AgentPicker } from './AgentPicker'
import { AgentProfileForm } from './AgentProfileForm'
import { RoomPopover } from './RoomPopover'
import { agentMember, loadAgentModelsMap, persistMemberAgentModels, type AgentModelSnapshot } from './agent-client'
import type { AgentIdentity } from '@shared/rooms-api'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import type { Room, RoomAvatarReference, RoomMember, RoomTask } from '@shared/rooms-api'
import { RoomAvatarGroup } from './RoomAvatar'
import { RoomAvatarPicker } from './RoomAvatarPicker'
import {
  roomRequestId,
  roomsClient,
  type RoomInput,
  type RoomPresetCatalog,
  type RoomRepositoryInput
} from './rooms-client'

import { RoomMemberEditor } from './RoomMemberEditor'
import { useChatStore } from '../../store/chat-store'
import { useRoomResource } from './useRoomResource'
import { roomPath } from './rooms-client'

export const roomFieldClass =
  'w-full rounded-lg border border-ds-border bg-ds-main px-3 py-2 text-sm text-ds-ink outline-none focus:ring-2 focus:ring-accent/30'
export const roomButtonClass =
  'rounded-lg border border-ds-border px-3 py-2 text-sm text-ds-ink hover:bg-ds-hover disabled:opacity-50'

export function RoomSettings({
  room,
  onClose,
  onSaved,
  variant = 'modal'
}: {
  room: Room | null
  onClose: () => void
  onSaved: (room: Room) => void
  variant?: 'modal' | 'panel'
}): ReactElement {
  const { t } = useTranslation('common')
  const [baselineRoom] = useState(room)
  const [name, setName] = useState(room?.name ?? '')
  const [description, setDescription] = useState(room?.description ?? '')
  const [avatar, setAvatar] = useState<RoomAvatarReference | undefined>(room?.avatar)
  const [mode, setMode] = useState<Room['collaborationMode']>(
    room?.collaborationMode ?? 'peer'
  )
  const [members, setMembers] = useState<RoomMember[]>(
    room?.members ?? []
  )
  const [defaultMemberId, setDefaultMemberId] = useState(
    room?.defaultMemberId ?? 'coordinator'
  )
  const [repositories, setRepositories] = useState<RoomRepositoryInput[]>(
    room?.repositories ?? []
  )
  const [catalog, setCatalog] = useState<RoomPresetCatalog>({ presets: [] })
  const activeTasks = useRoomResource<{
    tasks: RoomTask[]
    nextCursor?: string
  }>(
    room?.id ?? '',
    room
      ? roomPath(room.id) +
          '/tasks?limit=200&status=queued,waiting_dependency,running,needs_input,needs_approval,recovery_required,stopping,awaiting_acceptance'
      : null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingRef = useRef<{ fingerprint: string; id: string } | null>(null)
  const agentModels = useRef<Record<string, AgentModelSnapshot>>({})

  useEffect(() => {
    let alive = true
    void roomsClient
      .presets()
      .then((result) => {
        if (alive) setCatalog(result)
      })
      .catch((cause) => {
        if (alive) setError(String(cause.message ?? cause))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (room) return
    const controller = new AbortController()
    void roomsRequest<{ members: RoomMember[] }>('/v1/agents/default-members', 'POST', {}, controller.signal)
      .then((result) => { if (!controller.signal.aborted) {
        setMembers((current) => current.length ? current : result.members)
        setDefaultMemberId((current) => result.members.some((member) => member.id === current) ? current : result.members[0].id)
      } }).catch((cause) => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [room])
  const participantAgentKey = members.map((member) => member.participantAgentId ?? '').join(',')
  useEffect(() => {
    const ids = participantAgentKey.split(',').filter((id) => id && !agentModels.current[id])
    if (!ids.length) return
    let alive = true
    void loadAgentModelsMap(ids).then((map) => {
      if (!alive) return
      agentModels.current = { ...agentModels.current, ...map }
      setMembers((current) =>
        current.map((member) => {
          const models = member.participantAgentId ? map[member.participantAgentId] : undefined
          return models ? { ...member, modelRef: models.agent.modelRef } : member
        })
      )
    })
    return () => {
      alive = false
    }
  }, [participantAgentKey])
  const copyMember = async (member: RoomMember) => {
    if (!member.participantAgentId) return
    setBusy(true); setError('')
    try {
      const result = await roomsRequest<{ agent: AgentIdentity }>('/v1/agents', 'POST', {
        clientRequestId: roomRequestId(), copyFromAgentId: member.participantAgentId,
        name: member.displayName.slice(0, 72) + ' (2)' })
      setMembers((current) => [...current, { ...agentMember(result.agent, member.allowedRepositoryIds),
        role: member.role, roleNotes: member.roleNotes, defaultRepositoryId: member.defaultRepositoryId }])
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  const updateMember = (id: string, patch: Partial<RoomMember>): void => {
    setMembers((current) =>
      current.map((member) =>
        member.id === id
          ? { ...member, ...patch, revision: member.revision + 1 }
          : member
      )
    )
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await persistMemberAgentModels(members, agentModels.current)
      const savedMembers = members.map((member) =>
        member.participantAgentId ? { ...member, modelRef: undefined } : member
      )
      const input: RoomInput = {
        name: name.trim(),
        description,
        collaborationMode: mode,
        repositories: repositories.map(
          ({ id, displayPath, displayName, defaultBaseRef }) => ({
            ...(id ? { id } : {}),
            displayPath,
            ...(displayName ? { displayName } : {}),
            ...(defaultBaseRef?.trim()
              ? { defaultBaseRef: defaultBaseRef.trim() }
              : {})
          })
        ),
        ...(savedMembers.length ? { members: savedMembers, defaultMemberId } : {}),
        ...(avatar ? { avatar } : {})
      }
      const fingerprint = JSON.stringify(input)
      const requestId =
        pendingRef.current?.fingerprint === fingerprint
          ? pendingRef.current.id
          : roomRequestId()
      pendingRef.current = { fingerprint, id: requestId }
      const result = baselineRoom
        ? await roomsClient.update(baselineRoom, { ...input, avatar: avatar ?? null }, requestId)
        : await roomsClient.create(input, requestId)
      onSaved(result.room)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const addRepository = async (): Promise<void> => {
    try {
      const selection = await window.kunGui.pickWorkspaceDirectory()
      if (selection.canceled || !selection.path) return
      const path = selection.path
      const id = roomRequestId()
      if (!room && repositories.length === 0)
        setMembers((current) =>
          current.map((member) => ({
            ...member,
            allowedRepositoryIds: [id],
            defaultRepositoryId: id
          }))
        )
      setRepositories((current) => [
        ...current,
        {
          id,
          displayPath: path,
          displayName: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
        }
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const panelMode = variant === 'panel'
  return (
    <div className={panelMode ? 'flex min-h-0 flex-1 flex-col' : 'ds-no-drag absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4'}>
      <section
        role={panelMode ? undefined : 'dialog'}
        aria-modal={panelMode ? undefined : true}
        aria-label={t(room ? 'roomsSettings' : 'roomsNew')}
        onKeyDown={panelMode ? undefined : (event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault()
            onClose()
          }
          if (event.key !== 'Tab') return
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
            )
          )
          const first = focusable[0]
          const last = focusable.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
        className={panelMode ? 'flex min-h-0 flex-1 flex-col' : 'flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-ds-border bg-ds-main shadow-xl'}
      >
        {panelMode ? null : <header className="flex items-center justify-between border-b border-ds-border p-4">
          <h2 className="font-semibold text-ds-ink">
            {t(room ? 'roomsSettings' : 'roomsNew')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('roomsClose')}
            className={roomButtonClass}
          >
            <X size={16} />
          </button>
        </header>}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className={panelMode ? 'min-h-0 flex-1 overflow-y-auto p-5' : 'min-h-0 overflow-y-auto p-5'}
        >
          <div className="space-y-4">
            {!room || room.conversationKind !== 'user_agent' ? <div className="block text-sm text-ds-muted">
              {t('roomsGroupAvatar')}
              <RoomAvatarPicker
                id={room?.id ?? 'new-room'}
                label={name.trim() || t('roomsLabel')}
                avatar={avatar}
                fallback={<RoomAvatarGroup members={members} size={48} />}
                onChange={setAvatar}
              />
            </div> : null}
            <label className="block text-sm text-ds-muted">
              {t('roomsName')}
              <input
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={roomFieldClass}
              />
            </label>
            <label className="block text-sm text-ds-muted">
              {t('roomsDescriptionField')}
              <textarea
                maxLength={8000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={roomFieldClass}
                rows={2}
              />
            </label>
            <label className="block text-sm text-ds-muted">
              {t('roomsMode')}
              <select
                aria-label={t('roomsMode')}
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
                className={roomFieldClass}
              >
                <option value="peer">{t('roomsPeer')}</option>
                <option value="autonomous">{t('roomsAutonomous')}</option>
                <option value="directed">{t('roomsDirected')}</option>
              </select>
            </label>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-ds-ink">
                {t('roomsRepositories')}
              </h3>
              <button
                type="button"
                className={roomButtonClass}
                onClick={() => void addRepository()}
              >
                <Plus size={14} className="mr-1 inline" />
                {t('roomsAddRepository')}
              </button>
            </div>
            {repositories.map((repository, index) => (
              <div
                key={repository.id ?? index}
                className="space-y-2 rounded-xl border border-ds-border p-3"
              >
                <div className="flex gap-2">
                  <input
                    aria-label={t('roomsRepositoryName')}
                    className={roomFieldClass}
                    value={repository.displayName ?? ''}
                    onChange={(event) =>
                      setRepositories((current) =>
                        current.map((item, i) =>
                          i === index
                            ? { ...item, displayName: event.target.value }
                            : item
                        )
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label={t('roomsRemove')}
                    className={roomButtonClass}
                    onClick={() => {
                      setRepositories((current) =>
                        current.filter((_, i) => i !== index)
                      )
                      setMembers((current) =>
                        current.map((member) => ({
                          ...member,
                          allowedRepositoryIds:
                            member.allowedRepositoryIds.filter(
                              (id) => id !== repository.id
                            ),
                          ...(member.defaultRepositoryId === repository.id
                            ? { defaultRepositoryId: undefined }
                            : {})
                        }))
                      )
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="break-all text-xs text-ds-muted">
                  {repository.displayPath}
                </p>
                <input
                  aria-label={t('roomsBaseBranch')}
                  placeholder={t('roomsBaseBranch')}
                  className={roomFieldClass}
                  value={repository.defaultBaseRef ?? ''}
                  onChange={(event) =>
                    setRepositories((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, defaultBaseRef: event.target.value }
                          : item
                      )
                    )
                  }
                />
              </div>
            ))}
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-ds-ink">{t('roomsMembers')}</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={roomButtonClass}
                  onClick={() => {
                    onClose()
                    useChatStore.getState().openSettings('subagents')
                  }}
                >
                  {t('roomsManagePresets')}
                </button>
                {(!room?.conversationKind || room.conversationKind === 'group') ? <>
                  <AgentPicker label={t('agentsAddExisting')} excluded={members.map((member) => member.participantAgentId ?? '')}
                    onSelect={(agent) => setMembers((current) => [...current, agentMember(agent)])} />
                  <RoomPopover label={t('agentsCreateAndAdd')} trigger={<span>{t('agentsCreateAndAdd')}</span>} width={380}>
                    {(close) => <AgentProfileForm agent={null} onSaved={(agent) => {
                      setMembers((current) => [...current, agentMember(agent)]); close()
                    }} />}
                  </RoomPopover>
                </> : null}
              </div>
            </div>
            <label className="block text-sm text-ds-muted">
              {t('roomsDefaultMember')}
              <select
                value={defaultMemberId}
                onChange={(event) => setDefaultMemberId(event.target.value)}
                className={roomFieldClass}
              >
                {members
                  .filter((member) => member.enabled && !member.removedAt)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
              </select>
            </label>
            {members
              .filter((member) => !member.removedAt)
              .map((member) => (
                <RoomMemberEditor
                  key={member.id}
                  member={member}
                  members={members}
                  repositories={repositories}
                  catalog={catalog}
                  defaultMemberId={defaultMemberId}
                  hasActiveTasks={Boolean(
                    room &&
                    (!activeTasks.data ||
                      activeTasks.data.nextCursor ||
                      activeTasks.data.tasks.some(
                        (task) => task.ownerMemberId === member.id
                      ))
                  )}
                  onChange={(patch) => updateMember(member.id, patch)}
                  onCopy={() => void copyMember(member)}
                  onRemove={() =>
                    setMembers((current) =>
                      current
                        .filter((item) => item.id !== member.id)
                        .map((item) =>
                          item.reviewPolicy?.reviewerMemberId === member.id
                            ? {
                                ...item,
                                reviewPolicy: undefined,
                                revision: item.revision + 1
                              }
                            : item
                        )
                    )
                  }
                />
              ))}
            <p className="text-xs text-ds-faint">{t('roomsConfigHint')}</p>
            {error ? (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className={roomButtonClass}
              >
                {t('roomsCancel')}
              </button>
              <button
                disabled={busy || !name.trim() || !members.length}
                type="submit"
                className={`${roomButtonClass} bg-accent/10`}
              >
                {t(busy ? 'roomsLoading' : room ? 'roomsSave' : 'roomsCreate')}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
