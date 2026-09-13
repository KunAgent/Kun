import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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
import { RoomComposerContext, RoomComposerMentions } from './RoomComposerContext'
import { RoomComposerToolbar } from './RoomComposerToolbar'
import { useRoomComposerInput } from './useRoomComposerInput'
import './rooms-composer.css'

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
  rootRequestId?: string
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
  topicChoices = [],
  onSend
}: {
  room: Room
  tasks: RoomTask[]
  draftId?: string
  topicChoices?: Array<{ rootRequestId: string; title: string }>
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
      (room.collaborationMode !== 'directed' ||
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
  const { textareaRef, composingRef } = useRoomComposerInput(draft.body)
  const mentionListId = useId()
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
          rootRequestId?: string
        }>
      ).detail
      if (detail.roomId === room.id) {
        setDraft((draft) => ({
          ...draft,
          rootRequestId: detail.rootRequestId,
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
    const continueTopic = (event: Event) => {
      const detail = (
        event as CustomEvent<{ roomId: string; rootRequestId: string }>
      ).detail
      if (detail.roomId !== room.id) return
      setDraft((current) => ({
        ...current,
        rootRequestId: detail.rootRequestId,
        replyToMessageId: undefined,
        replyBody: undefined
      }))
      textareaRef.current?.focus()
    }
    if (draftId) return
    window.addEventListener?.('kun-room-continue-topic', continueTopic)
    window.addEventListener?.('kun-room-reply', reply)
    window.addEventListener?.('kun-room-task-reply', taskReply)
    return () => {
      window.removeEventListener?.('kun-room-continue-topic', continueTopic)
      window.removeEventListener?.('kun-room-reply', reply)
      window.removeEventListener?.('kun-room-task-reply', taskReply)
    }
  }, [room.id, draftId, textareaRef])
  useEffect(() => {
    writeBrowserStorageItem(
      `kun.rooms.draft.${storageId}`,
      JSON.stringify(draft)
    )
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
      ...(draft.rootRequestId ? { rootRequestId: draft.rootRequestId } : {}),
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
      setMentionQuery(null)
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

  const disabled = busy || uploading || Boolean(room.archivedAt)
  const topicTitle = topicChoices.find((topic) => topic.rootRequestId === draft.rootRequestId)?.title
    ?? draft.replyBody ?? draft.rootRequestId

  return (
    <form
      className="rooms-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <fieldset disabled={disabled} className="rooms-composer-surface">
        <RoomComposerContext room={room} tasks={tasks} mentions={draft.mentions}
          attachments={draft.attachments} taskId={draft.taskId} repositoryId={draft.repositoryId}
          replyToMessageId={draft.replyToMessageId} replyBody={draft.replyBody}
          onMentions={(mentions) => patch({ mentions })}
          onAttachments={(attachments) => patch({ attachments })}
          onTask={() => patch({ taskId: '' })}
          onRepository={() => patch({ repositoryId: '' })}
          onClearReply={() => patch({ replyToMessageId: undefined, replyBody: undefined })} />
        {mentionQuery !== null ? (
          <RoomComposerMentions room={room} tasks={tasks} candidates={candidates}
            mentionIndex={mentionIndex} listId={mentionListId} onChoose={chooseMention} />
        ) : null}
        <textarea
          ref={textareaRef}
          aria-controls={
            mentionQuery !== null ? mentionListId : undefined
          }
          aria-activedescendant={
            mentionQuery !== null && candidates[mentionIndex]
              ? `${mentionListId}-${candidates[mentionIndex].id}`
              : undefined
          }
          className="rooms-composer-textarea"
          rows={1}
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
          onBlur={(event) => {
            if (event.relatedTarget?.getAttribute('role') !== 'option') setMentionQuery(null)
          }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(event) => {
            const composing = event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229
            if (mentionQuery !== null && !composing) {
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
              !composing
            ) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <input hidden multiple ref={fileRef} type="file"
          onChange={(event) => void attach(event.target.files)} />
        <RoomComposerToolbar room={room} tasks={tasks} taskId={draft.taskId}
          repositoryId={draft.repositoryId} rootRequestId={draft.rootRequestId}
          topicTitle={topicTitle} topicChoices={topicChoices}
          showTopic={!draftId && (room.collaborationMode === 'peer' || Boolean(draft.rootRequestId))}
          intent={draft.intent} busy={busy} uploading={uploading} disabled={disabled}
          attachmentLimit={draft.attachments.length >= 20}
          canSend={unavailableMembers.length === 0 && Boolean(draft.body.trim() || draft.attachments.length)}
          onAttach={() => { setMentionQuery(null); fileRef.current?.click() }}
          onMention={() => {
            const caret = textareaRef.current?.selectionStart ?? draft.body.length
            mentionRange.current = { start: caret, end: caret }
            setMentionQuery('')
            setMentionIndex(0)
            textareaRef.current?.focus()
          }}
          onTask={(taskId) => patch({ taskId })}
          onRepository={(repositoryId) => patch({ repositoryId })}
          onTopic={(id) => patch({ rootRequestId: id || undefined, replyToMessageId: undefined, replyBody: undefined })}
          onIntent={(intent) => patch({ intent })} />
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
              : room.collaborationMode === 'peer'
                ? 'roomsPeerHint'
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
