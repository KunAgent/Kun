import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip, Send, X } from 'lucide-react'
import type { Room, RoomTask, SendRoomMessage } from '@shared/rooms-api'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import { uploadRuntimeAttachment } from '../../lib/runtime-attachment'
import { roomRequestId } from './rooms-client'
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
  onSend
}: {
  room: Room
  tasks: RoomTask[]
  onSend: (message: SendRoomMessage) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState(() => readDraft(room.id))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    writeBrowserStorageItem(`kun.rooms.draft.${room.id}`, JSON.stringify(draft))
  }, [draft, room.id])
  const patch = (value: Partial<Draft>): void =>
    setDraft((current) => ({ ...current, ...value }))

  const submit = async (): Promise<void> => {
    if (
      busy ||
      uploading ||
      room.archivedAt ||
      (!draft.body.trim() && !draft.attachments.length)
    )
      return
    const content = {
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
      `kun.rooms.draft.${room.id}`,
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
        <textarea
          className={`${roomFieldClass} resize-none`}
          rows={3}
          maxLength={64000}
          value={draft.body}
          placeholder={t('roomsComposerPlaceholder')}
          aria-label={t('roomsComposerPlaceholder')}
          onChange={(event) => patch({ body: event.target.value })}
          onKeyDown={(event) => {
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
            disabled={!draft.body.trim() && !draft.attachments.length}
          >
            <Send size={15} />
            {t(
              busy ? 'roomsSending' : uploading ? 'roomsLoading' : 'roomsSend'
            )}
          </button>
        </div>
      </fieldset>
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
