import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip, Send, X } from 'lucide-react'
import type { Room, RoomTask, SendRoomMessage } from '@shared/rooms-api'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import { uploadRuntimeAttachment } from '../../lib/runtime-attachment'
import {
  roomRequestId,
  roomsClient,
  type RoomPresetCatalog
} from './rooms-client'
import { roomButtonClass, roomFieldClass } from './RoomSettings'

type Draft = {
  body: string
  mentions: string[]
  taskId: string
  repositoryId: string
  intent: SendRoomMessage['executionIntent']
  attachments: Array<{ id: string; name: string }>
  requestId: string
  fingerprint: string
  replyToMessageId?: string
  replyBody?: string
}
function emptyDraft(): Draft {
  return {
    body: '',
    mentions: [],
    taskId: '',
    repositoryId: '',
    intent: 'auto',
    attachments: [],
    requestId: '',
    fingerprint: ''
  }
}
function readDraft(roomId: string): Draft {
  try {
    const stored = JSON.parse(
      readBrowserStorageItem(`kun.rooms.draft.${roomId}`) ?? 'null'
    )
    return stored && typeof stored.body === 'string'
      ? { ...emptyDraft(), ...stored }
      : emptyDraft()
  } catch {
    return emptyDraft()
  }
}

export function RoomComposer({
  room,
  tasks,
  draftId,
  onSend
}: {
  room: Room
  tasks: RoomTask[]
  draftId?: string
  onSend: (message: SendRoomMessage) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const storageId = draftId ?? room.id
  const [draft, setDraft] = useState(() => readDraft(storageId))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<RoomPresetCatalog | null>(null)
  useEffect(() => {
    let active = true
    void roomsClient
      .presets()
      .then((value) => {
        if (active) setCatalog(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [room.id, room.revision])
  const addressed = room.members.filter(
    (member) =>
      member.enabled &&
      !member.removedAt &&
      (room.collaborationMode === 'autonomous' ||
        (draft.mentions.length
          ? draft.mentions.includes(member.id)
          : member.id === room.defaultMemberId))
  )
  const unavailableMembers = catalog
    ? addressed.filter((member) => {
        const preset = catalog.presets.find(
          (item) => item.id === member.presetId
        )
        const provider =
          member.modelRef?.providerId ??
          preset?.providerId ??
          catalog.defaultModel?.providerId
        return (
          (provider && catalog.unsupportedProviderIds?.includes(provider)) ||
          (!member.modelRef && preset?.available === false)
        )
      })
    : []
  const fileRef = useRef<HTMLInputElement>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionRange = useRef({ start: 0, end: 0 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const candidates = room.members.filter(
    (member) =>
      member.enabled &&
      !member.removedAt &&
      member.displayName
        .toLocaleLowerCase()
        .includes((mentionQuery ?? '').toLocaleLowerCase())
  )
  const chooseMention = (id: string) => {
    patch({
      mentions: [...new Set([...draft.mentions, id])],
      body:
        draft.body.slice(0, mentionRange.current.start) +
        draft.body.slice(mentionRange.current.end)
    })
    setMentionQuery(null)
    textareaRef.current?.focus()
  }
  useEffect(() => {
    const reply = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          roomId: string
          messageId: string
          body?: string
        }>
      ).detail
      if (detail.roomId === room.id) {
        setDraft((draft) => ({
          ...draft,
          replyToMessageId: detail.messageId,
          replyBody: detail.body?.slice(0, 160)
        }))
        textareaRef.current?.focus()
      }
    }
    const taskReply = (event: Event) => {
      const detail = (
        event as CustomEvent<{ roomId: string; taskId: string; body: string }>
      ).detail
      if (detail.roomId === room.id) {
        setDraft((draft) => ({
          ...draft,
          taskId: detail.taskId,
          body: draft.body.trim() ? draft.body : detail.body,
          intent: 'execute'
        }))
        textareaRef.current?.focus()
      }
    }
    if (draftId) return
    window.addEventListener?.('kun-room-reply', reply)
    window.addEventListener?.('kun-room-task-reply', taskReply)
    return () => {
      window.removeEventListener?.('kun-room-reply', reply)
      window.removeEventListener?.('kun-room-task-reply', taskReply)
    }
  }, [room.id, draftId])
  useEffect(() => {
    writeBrowserStorageItem(`kun.rooms.draft.${storageId}`, JSON.stringify(draft))
  }, [draft, storageId])
  const patch = (value: Partial<Draft>): void =>
    setDraft((current) => ({ ...current, ...value }))

  const submit = async (): Promise<void> => {
    if (
      busy ||
      unavailableMembers.length > 0 ||
      uploading ||
      room.archivedAt ||
      (!draft.body.trim() && !draft.attachments.length)
    )
      return
    const content = {
      ...(draft.replyToMessageId
        ? { replyToMessageId: draft.replyToMessageId }
        : {}),
      body: draft.body,
      mentionMemberIds: draft.mentions,
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
      ...(draft.repositoryId ? { repositoryId: draft.repositoryId } : {}),
      executionIntent: draft.intent,
      attachmentIds: draft.attachments.map(({ id }) => id)
    }
    const fingerprint = JSON.stringify(content)
    const requestId =
      draft.fingerprint === fingerprint && draft.requestId
        ? draft.requestId
        : roomRequestId()
    // Store identity before dispatch so a lost acknowledgement/reload can retry
    // the exact request, while an edited draft receives a fresh identity.
    const pending = { ...draft, fingerprint, requestId }
    setDraft(pending)
    writeBrowserStorageItem(
      `kun.rooms.draft.${storageId}`,
      JSON.stringify(pending)
    )
    setBusy(true)
    setError('')
    try {
      await onSend({ ...content, clientRequestId: requestId })
      setDraft(emptyDraft())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const attach = async (files: FileList | null): Promise<void> => {
    if (!files) return
    setUploading(true)
    setError('')
    try {
      for (const file of Array.from(files).slice(
        0,
        20 - draft.attachments.length
      )) {
        const localFilePath = window.kunGui.getPathForFile(file)
        let dataBase64 = ''
        if (!localFilePath) {
          dataBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve(String(reader.result).split(',')[1] ?? '')
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          })
        }
        const attachment = await uploadRuntimeAttachment({
          name: file.name,
          mimeType: file.type,
          dataBase64,
          localFilePath: localFilePath || undefined
        })
        setDraft((current) => ({
          ...current,
          attachments: [
            ...current.attachments,
            { id: attachment.id, name: attachment.name }
          ]
        }))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <form
      className="shrink-0 border-t border-ds-border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <fieldset
        disabled={busy || uploading || Boolean(room.archivedAt)}
        className="space-y-2"
      >
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={t('roomsMention')}
            className={`${roomFieldClass} !w-auto max-w-48`}
            value=""
            onChange={(event) => {
              if (
                event.target.value &&
                !draft.mentions.includes(event.target.value)
              )
                patch({ mentions: [...draft.mentions, event.target.value] })
            }}
          >
            <option value="">@ {t('roomsMention')}</option>
            {room.members
              .filter((member) => member.enabled && !member.removedAt)
              .map((member) => (
                <option value={member.id} key={member.id}>
                  {member.displayName}
                </option>
              ))}
          </select>
          <select
            aria-label={t('roomsTaskReference')}
            className={`${roomFieldClass} !w-auto max-w-48`}
            value={draft.taskId}
            onChange={(event) => patch({ taskId: event.target.value })}
          >
            <option value="">{t('roomsNoTask')}</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          <select
            aria-label={t('roomsDefaultRepository')}
            className={`${roomFieldClass} !w-auto max-w-48`}
            value={draft.repositoryId}
            onChange={(event) => patch({ repositoryId: event.target.value })}
          >
            <option value="">{t('roomsNoRepository')}</option>
            {room.repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.displayName}
              </option>
            ))}
          </select>
        </div>
        {draft.mentions.length || draft.attachments.length ? (
          <div className="flex flex-wrap gap-1">
            {draft.mentions.map((id) => (
              <button
                type="button"
                key={id}
                className="flex max-w-full items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-xs text-ds-ink"
                onClick={() =>
                  patch({
                    mentions: draft.mentions.filter((value) => value !== id)
                  })
                }
              >
                @
                {room.members.find((member) => member.id === id)?.displayName ??
                  id}
                <X size={12} />
              </button>
            ))}
            {draft.attachments.map((attachment) => (
              <button
                type="button"
                key={attachment.id}
                className="flex max-w-full items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-xs text-ds-ink"
                onClick={() =>
                  patch({
                    attachments: draft.attachments.filter(
                      (value) => value.id !== attachment.id
                    )
                  })
                }
              >
                <span className="truncate">{attachment.name}</span>
                <X size={12} />
              </button>
            ))}
          </div>
        ) : null}
        {draft.replyToMessageId ? (
          <div className="flex gap-2 text-xs text-accent">
            <span className="min-w-0 truncate">
              {t('roomsReply')} · {draft.replyBody ?? draft.replyToMessageId}
            </span>
            <button
              onClick={() =>
                patch({ replyToMessageId: undefined, replyBody: undefined })
              }
              type="button"
            >
              {t('roomsCancel')}
            </button>
          </div>
        ) : null}
        {mentionQuery !== null ? (
          <div
            role="listbox"
            id="room-mention-list"
            className="max-h-40 overflow-auto rounded border border-ds-border bg-ds-main p-2"
          >
            {candidates.map((member, index) => (
              <button
                key={member.id}
                id={'room-mention-' + member.id}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                className={`block w-full p-2 text-left text-sm hover:bg-ds-hover ${index === mentionIndex ? 'bg-accent/10' : ''}`}
                onClick={() => chooseMention(member.id)}
              >
                {member.displayName} ·{' '}
                {t(
                  `rooms${member.role?.[0]?.toUpperCase()}${member.role?.slice(1)}`
                )}{' '}
                ·{' '}
                {room.repositories.find(
                  (repo) => repo.id === member.defaultRepositoryId
                )?.displayName ?? t('roomsNoRepository')}
                {tasks.some(
                  (task) =>
                    task.ownerMemberId === member.id &&
                    ['running', 'needs_input', 'needs_approval'].includes(
                      task.status
                    )
                )
                  ? ` · ${t('roomsState_running')}`
                  : ''}
              </button>
            ))}
            {!candidates.length ? (
              <span className="text-xs text-ds-muted">
                {t('roomsNoResults')}
              </span>
            ) : null}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          aria-controls={
            mentionQuery !== null ? 'room-mention-list' : undefined
          }
          aria-activedescendant={
            mentionQuery !== null && candidates[mentionIndex]
              ? 'room-mention-' + candidates[mentionIndex].id
              : undefined
          }
          className={`${roomFieldClass} resize-none`}
          rows={3}
          maxLength={64000}
          value={draft.body}
          placeholder={t('roomsComposerPlaceholder')}
          aria-label={t('roomsComposerPlaceholder')}
          onChange={(event) => {
            patch({ body: event.target.value })
            const end = event.target.selectionStart ?? event.target.value.length
            const match = /(?:^|\s)@([^@\s]*)$/.exec(
              event.target.value.slice(0, end)
            )
            setMentionQuery(match?.[1] ?? null)
            setMentionIndex(0)
            if (match)
              mentionRange.current = { start: end - match[1].length - 1, end }
          }}
          onKeyDown={(event) => {
            if (mentionQuery !== null && !event.nativeEvent.isComposing) {
              if (event.key === 'Escape') {
                event.preventDefault()
                setMentionQuery(null)
                return
              }
              if (
                ['ArrowDown', 'ArrowUp'].includes(event.key) &&
                candidates.length
              ) {
                event.preventDefault()
                setMentionIndex(
                  (index) =>
                    (index +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      candidates.length) %
                    candidates.length
                )
                return
              }
              if (
                event.key === 'Enter' &&
                !event.metaKey &&
                !event.ctrlKey &&
                candidates[mentionIndex]
              ) {
                event.preventDefault()
                chooseMention(candidates[mentionIndex].id)
                return
              }
            }
            if (
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            hidden
            multiple
            ref={fileRef}
            type="file"
            onChange={(event) => void attach(event.target.files)}
          />
          <button
            type="button"
            className={roomButtonClass}
            onClick={() => fileRef.current?.click()}
            aria-label={t('roomsAttach')}
            disabled={draft.attachments.length >= 20}
          >
            <Paperclip size={16} />
          </button>
          <select
            className={`${roomFieldClass} !w-auto max-w-48`}
            value={draft.intent}
            aria-label={t('roomsAutoIntent')}
            onChange={(event) =>
              patch({ intent: event.target.value as Draft['intent'] })
            }
          >
            <option value="auto">{t('roomsAutoIntent')}</option>
            <option value="discussion">{t('roomsDiscussionIntent')}</option>
            <option value="execute">{t('roomsExecuteIntent')}</option>
          </select>
          <button
            type="submit"
            className={`${roomButtonClass} ml-auto flex items-center gap-2 bg-accent/10`}
            disabled={
              unavailableMembers.length > 0 ||
              (!draft.body.trim() && !draft.attachments.length)
            }
          >
            <Send size={15} />
            {t(
              busy ? 'roomsSending' : uploading ? 'roomsLoading' : 'roomsSend'
            )}
          </button>
        </div>
      </fieldset>
      {unavailableMembers.length ? (
        <p role="alert" className="mt-2 text-xs text-amber-600">
          {t('roomsSdkUnavailable')} ·{' '}
          {unavailableMembers.map((member) => member.displayName).join(', ')}
        </p>
      ) : null}
      {room.archivedAt ? (
        <p className="mt-2 text-xs text-ds-muted">{t('roomsArchiveHint')}</p>
      ) : (
        <p className="mt-2 text-xs text-ds-faint">
          {t(
            room.collaborationMode === 'directed'
              ? 'roomsDirectedHint'
              : 'roomsAutoHint'
          )}
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {error} {t('roomsSendRetry')}
        </p>
      ) : null}
    </form>
  )
}
