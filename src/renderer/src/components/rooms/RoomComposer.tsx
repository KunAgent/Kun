import { AgentPicker } from './AgentPicker'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomTask, SendRoomMessage, RoomContentReference } from '@shared/rooms-api'
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
import { RoomComposerContext } from './RoomComposerContext'
import { RoomComposerToolbar } from './RoomComposerToolbar'
import { RoomRichInput, type RoomRichInputHandle } from './RoomRichInput'
import { roomSendMentionIds, roomMentionToken, roomUnmarkMentions, ROOM_ALL_MENTION } from './room-mentions'
import { RoomContentReferencePicker, RoomContentReferenceChips } from './RoomContentReferencePicker'
import { RoomPollCreator } from './RoomPollCreator'
import './rooms-interactions.css'
import './rooms-composer.css'

type Draft = {
  executionAgentId?: string
  executionAgentName?: string
  body: string
  references: RoomContentReference[]
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
    references: [],
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

function RoomComposerEditor({
  room,
  tasks,
  draftId,
  replyTarget,
  topicChoices = [],
  onSend
}: {
  room: Room
  tasks: RoomTask[]
  draftId?: string
  replyTarget?: { messageId: string; body: string; rootRequestId?: string }
  topicChoices?: Array<{ rootRequestId: string; title: string }>
  onSend: (message: SendRoomMessage) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const storageId = draftId ?? room.id
  const [draft, setDraft] = useState(() => {
    const stored = readDraft(storageId)
    // Existing drafts stored mentions outside the text; migrate their chips without losing recipients.
    const missing = stored.mentions.filter((id) => !stored.body.includes(id === ROOM_ALL_MENTION ? '(#kun-room-all)' : '(#kun-room-member-' + id + ')'))
    return { ...stored, body: missing.map((id) => roomMentionToken(id,
      room.members.find((member) => member.id === id)?.displayName ?? id)).join(' ') + (missing.length ? ' ' : '') + stored.body }
  })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [pollOpen, setPollOpen] = useState(false)
  const editorRef = useRef<RoomRichInputHandle>(null)
  const sendMentions = roomSendMentionIds(draft.mentions, room)
  const replyToMessageId = draft.replyToMessageId ?? replyTarget?.messageId
  const rootRequestId = draft.rootRequestId ?? replyTarget?.rootRequestId
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
        (sendMentions.length
          ? sendMentions.includes(member.id)
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
        editorRef.current?.focus()
      }
    }
    const taskReply = (event: Event) => {
      const detail = (
        event as CustomEvent<{ roomId: string; taskId: string; body: string }>
      ).detail
      if (detail.roomId === room.id) {
        setDraft((draft) => ({
          ...draft,
          taskId: detail.taskId, executionAgentId: undefined, executionAgentName: undefined,
          body: draft.body.trim() ? draft.body : detail.body,
          intent: 'execute'
        }))
        editorRef.current?.focus()
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
      editorRef.current?.focus()
    }
    const example = (event: Event) => {
      const detail = (event as CustomEvent<{ roomId: string; body: string }>).detail
      if (detail.roomId !== room.id) return
      setDraft((current) => current.body.trim() ? current : { ...current, body: detail.body, intent: 'discussion' })
      editorRef.current?.focus()
    }
    if (draftId) return
    window.addEventListener('kun-room-example', example)
    window.addEventListener?.('kun-room-continue-topic', continueTopic)
    window.addEventListener?.('kun-room-reply', reply)
    window.addEventListener?.('kun-room-task-reply', taskReply)
    return () => {
      window.removeEventListener('kun-room-example', example)
      window.removeEventListener?.('kun-room-continue-topic', continueTopic)
      window.removeEventListener?.('kun-room-reply', reply)
      window.removeEventListener?.('kun-room-task-reply', taskReply)
    }
  }, [room.id, draftId])
  const replyTargetId = replyTarget?.messageId, replyTargetBody = replyTarget?.body, replyTargetRoot = replyTarget?.rootRequestId
  useEffect(() => {
    if (replyTargetId) setDraft((current) => ({ ...current, replyToMessageId: replyTargetId,
      replyBody: replyTargetBody, rootRequestId: replyTargetRoot }))
  }, [replyTargetId, replyTargetBody, replyTargetRoot])
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
      (!draft.body.trim() && !draft.attachments.length && !draft.references.length)
    )
      return
    const content = {
      ...(rootRequestId ? { rootRequestId } : {}),
      ...(replyToMessageId
        ? { replyToMessageId }
        : {}),
      body: draft.body,
      mentionMemberIds: sendMentions,
      ...(draft.references.length ? { references: draft.references } : {}),
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
      ...(draft.repositoryId ? { repositoryId: draft.repositoryId } : {}),
      executionIntent: draft.intent,
      ...(draft.executionAgentId ? { executionAgentId: draft.executionAgentId, designatedAgentIds: [draft.executionAgentId] } : {}),
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

  const disabled = busy || uploading || Boolean(room.archivedAt)
  const topicTitle = topicChoices.find((topic) => topic.rootRequestId === rootRequestId)?.title
    ?? draft.replyBody ?? rootRequestId

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
          replyToMessageId={replyToMessageId} replyBody={draft.replyBody ?? replyTarget?.body}
          onMentions={(mentions) => patch({ mentions, body: roomUnmarkMentions(draft.body, draft.mentions.filter((id) => !mentions.includes(id))) })}
          onAttachments={(attachments) => patch({ attachments })}
          onTask={() => patch({ taskId: '' })}
          onRepository={() => patch({ repositoryId: '' })}
          onClearReply={() => patch({ replyToMessageId: undefined, replyBody: undefined })} />
        <RoomContentReferenceChips references={draft.references} onChange={(references) => patch({ references })} disabled={disabled} />
        {room.conversationKind === 'user_agent' && !draft.taskId && draft.intent !== 'discussion' ? <div className="agent-memory-actions">
          <AgentPicker label={draft.executionAgentName ? t('agentsExecutionOwner', { name: draft.executionAgentName }) : t('agentsChooseExecutionOwner')}
            onSelect={(agent) => patch({ executionAgentId: agent.id, executionAgentName: agent.name })} />
          {draft.executionAgentId ? <button type="button" onClick={() => patch({ executionAgentId: undefined, executionAgentName: undefined })}>{t('agentsUseCurrentAgent')}</button> : null}
        </div> : null}
        <RoomRichInput ref={editorRef} room={room} value={draft.body} mentions={draft.mentions}
          disabled={disabled} placeholder={t('roomsComposerPlaceholder')} onChange={patch}
          onSubmit={() => void submit()} onPasteFiles={(files) => void attach(files)} />
        <RoomContentReferencePicker room={room} tasks={tasks} references={draft.references}
          onChange={(references) => patch({ references })} disabled={disabled} />
        {pollOpen ? <RoomPollCreator roomId={room.id} replyToMessageId={replyToMessageId}
          onClose={() => setPollOpen(false)} /> : null}
        <input hidden multiple ref={fileRef} type="file"
          onChange={(event) => void attach(event.target.files)} />
        <RoomComposerToolbar room={room} tasks={tasks} taskId={draft.taskId}
          repositoryId={draft.repositoryId} rootRequestId={rootRequestId}
          topicTitle={topicTitle} topicChoices={topicChoices}
          showTopic={!draftId && (room.collaborationMode === 'peer' || Boolean(draft.rootRequestId))}
          intent={draft.intent} busy={busy} uploading={uploading} disabled={disabled}
          attachmentLimit={draft.attachments.length >= 20}
          canSend={unavailableMembers.length === 0 && Boolean(draft.body.trim() || draft.attachments.length || draft.references.length)}
          onAttach={() => fileRef.current?.click()}
          onMention={() => editorRef.current?.insertText('@')}
          onEmoji={(emoji) => editorRef.current?.insertText(emoji)} onPoll={() => setPollOpen((value) => !value)}
          onTask={(taskId) => patch({ taskId, executionAgentId: undefined, executionAgentName: undefined })}
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


export function RoomComposer(props: Parameters<typeof RoomComposerEditor>[0]): ReactElement {
  return <RoomComposerEditor key={props.draftId ?? props.room.id} {...props} />
}
