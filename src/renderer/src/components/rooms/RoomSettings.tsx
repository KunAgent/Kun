import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import type { Room, RoomMember, RoomTask } from '@shared/rooms-api'
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
  onSaved
}: {
  room: Room | null
  onClose: () => void
  onSaved: (room: Room) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [baselineRoom] = useState(room)
  const [name, setName] = useState(room?.name ?? '')
  const [description, setDescription] = useState(room?.description ?? '')
  const [mode, setMode] = useState<Room['collaborationMode']>(
    room?.collaborationMode ?? 'peer'
  )
  const [members, setMembers] = useState<RoomMember[]>(
    room?.members ??
      (['coordinator', 'developer', 'reviewer'] as const).map((role) => ({
        id: role,
        displayName: t(`rooms${role[0].toUpperCase()}${role.slice(1)}`),
        presetId: role,
        role,
        roleNotes: '',
        enabled: true,
        allowedRepositoryIds: [],
        revision: 0
      }))
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
        ...(members.length ? { members, defaultMemberId } : {})
      }
      const fingerprint = JSON.stringify(input)
      const requestId =
        pendingRef.current?.fingerprint === fingerprint
          ? pendingRef.current.id
          : roomRequestId()
      pendingRef.current = { fingerprint, id: requestId }
      const result = baselineRoom
        ? await roomsClient.update(baselineRoom, input, requestId)
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

  return (
    <div className="ds-no-drag absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t(room ? 'roomsSettings' : 'roomsNew')}
        onKeyDown={(event) => {
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
        className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-ds-border bg-ds-main shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-ds-border p-4">
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
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className="min-h-0 overflow-y-auto p-5"
        >
          <div className="space-y-4">
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
                <button
                  type="button"
                  className={roomButtonClass}
                  onClick={() =>
                    setMembers((current) => [
                      ...current,
                      {
                        id: roomRequestId(),
                        displayName: t('roomsDeveloper'),
                        presetId: 'developer',
                        role: 'developer',
                        roleNotes: '',
                        enabled: true,
                        allowedRepositoryIds: [],
                        revision: 0
                      }
                    ])
                  }
                >
                  {t('roomsAddMember')}
                </button>
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
                  onCopy={() =>
                    setMembers((current) => [
                      ...current,
                      {
                        ...structuredClone(member),
                        id: roomRequestId(),
                        displayName: member.displayName.slice(0, 76) + ' (2)',
                        revision: 0
                      }
                    ])
                  }
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
                disabled={busy || !name.trim()}
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
