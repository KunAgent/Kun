import type { RoomPendingAttachment } from './useRoomPendingSends'
import { RoomPermissionPicker } from './RoomPermissionPicker'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomTask, SendRoomMessage, RoomContentReference } from '@shared/rooms-api'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import { useRoomAttachmentUploads } from './useRoomAttachmentUploads'
import { RoomAttachmentUploads } from './RoomAttachmentUploads'
import {
  roomRequestId,
  roomsClient,
  roomsRequest,
  type RoomPresetCatalog
} from './rooms-client'
import { memberModelUnavailable, useRoomAgentModels } from './agent-client'
import { RoomComposerContext } from './RoomComposerContext'
import { isRoomComposerImage, roomComposerImagePreview } from './room-composer-image-preview'
import { RoomComposerToolbar } from './RoomComposerToolbar'
import { RoomRichInput, type RoomRichInputHandle } from './RoomRichInput'
import { roomSendMentionIds, roomMentionToken, roomUnmarkMentions, ROOM_ALL_MENTION } from './room-mentions'
import { RoomContentReferencePicker, RoomContentReferenceChips } from './RoomContentReferencePicker'
import { RoomPollCreator } from './RoomPollCreator'
import './rooms-interactions.css'
import './rooms-composer.css'
import { roomComposerFileReference, type RoomFileReferenceDetail } from './room-composer-file-reference'

type Draft = {
  executionAgentId?: string
  executionAgentName?: string
  body: string
  references: RoomContentReference[]
  mentions: string[]
  taskId: string
  repositoryId: string
  intent: SendRoomMessage['executionIntent']
  attachments: Array<{ id: string; name: string; mimeType?: string; previewUrl?: string }>
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
  onSend, onStop, onConnectProject, onClearReply, responding, autoFocus = true, quickTools = false, modelControl, compactControls = true
}: {
  onStop?: () => void
  onClearReply?: () => void
  modelControl?: ReactNode
  compactControls?: boolean
  /** Show emoji / mention / attach / poll directly in the toolbar (desktop IM layout). */
  quickTools?: boolean
  onConnectProject?: () => void
  responding?: boolean
  autoFocus?: boolean
  room: Room
  tasks: RoomTask[]
  draftId?: string
  replyTarget?: { messageId: string; body: string; rootRequestId?: string }
  topicChoices?: Array<{ rootRequestId: string; title: string }>
  onSend: (message: SendRoomMessage, attachments?: RoomPendingAttachment[]) => Promise<void>
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
  useEffect(() => {
    if (draftId) return
    const refresh = (event: Event): void => {
      if ((event as CustomEvent<{ roomId?: string }>).detail?.roomId !== room.id) return
      // This editor also publishes the event. Preserve object identity for an
      // unchanged draft so its own storage notification cannot loop or restore sent text.
      setDraft((current) => {
        const next = readDraft(storageId)
        return JSON.stringify(current) === JSON.stringify(next) ? current : next
      })
    }
    window.addEventListener('kun-room-draft-updated', refresh)
    return () => window.removeEventListener('kun-room-draft-updated', refresh)
  }, [room.id, storageId, draftId])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pollOpen, setPollOpen] = useState(false)
  const editorRef = useRef<RoomRichInputHandle>(null)
  useEffect(() => {
    if (!autoFocus) return
    const timer = setTimeout(() => editorRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [autoFocus])
  const sendMentions = roomSendMentionIds(draft.mentions, room)
  const replyToMessageId = draft.replyToMessageId ?? replyTarget?.messageId
  const rootRequestId = draft.rootRequestId ?? replyTarget?.rootRequestId
  const [catalog, setCatalog] = useState<RoomPresetCatalog | null>(null)
  const agentModels = useRoomAgentModels(room)
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
  const unavailableMembers = room.conversationKind !== 'user_agent' && catalog
    ? addressed.filter((member) =>
        memberModelUnavailable(
          member,
          catalog,
          member.participantAgentId ? agentModels[member.participantAgentId] : undefined
        )
      )
    : []
  const fileRef = useRef<HTMLInputElement>(null)
  const transientPreviews = useRef(new Map<string, string>())
  const uploads = useRoomAttachmentUploads((attachment, file, preview) => {
    if (preview?.transient) transientPreviews.current.set(attachment.id, preview.url)
    setDraft((current) => ({ ...current, attachments: [...current.attachments, { id: attachment.id,
      name: attachment.name, mimeType: attachment.mimeType || file.type,
      ...(!preview?.transient && preview ? { previewUrl: preview.url } : {}) }] }))
  })
  const uploading = uploads.uploading
  useEffect(() => {
    if (draftId) return
    const addFile = (event: Event): void => {
      const detail = (event as CustomEvent<RoomFileReferenceDetail>).detail
      if (!detail || detail.roomId !== room.id) return
      const reference = roomComposerFileReference(room, detail)
      setDraft((current) => reference ? { ...current, references: [
        ...current.references.filter((item) => JSON.stringify(item) !== JSON.stringify(reference)), reference
      ].slice(-20) } : { ...current, body: [current.body, detail.reference.path].filter(Boolean).join('\n') })
      editorRef.current?.focus()
    }
    window.addEventListener('kun-room-file-reference', addFile)
    return () => window.removeEventListener('kun-room-file-reference', addFile)
  }, [room, draftId])
  const storedImagesWithoutPreviews = useRef(draft.attachments.filter((attachment) =>
    isRoomComposerImage(attachment.name, attachment.mimeType) && !attachment.previewUrl))
  const releasePreview = (id: string): void => {
    const url = transientPreviews.current.get(id)
    if (!url) return
    URL.revokeObjectURL(url)
    transientPreviews.current.delete(id)
  }
  useEffect(() => () => {
    for (const url of transientPreviews.current.values()) URL.revokeObjectURL(url)
    transientPreviews.current.clear()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    for (const attachment of storedImagesWithoutPreviews.current) {
      void roomsRequest<{ attachment: { textFallback?: { dataBase64: string; mimeType: string };
        visualPreview?: { dataBase64: string; mimeType: string } } }>(
        '/v1/attachments/' + encodeURIComponent(attachment.id), 'GET', undefined, controller.signal
      ).then(async ({ attachment: metadata }) => {
        const source = metadata.visualPreview ?? metadata.textFallback
        if (!source?.mimeType.startsWith('image/') || source.dataBase64.length > 2 * 1024 * 1024) return
        const bytes = Uint8Array.from(atob(source.dataBase64), (char) => char.charCodeAt(0))
        const file = new File([bytes], attachment.name, { type: source.mimeType })
        const preview = await roomComposerImagePreview(file)
        if (!preview) return
        if (controller.signal.aborted) {
          if (preview.transient) URL.revokeObjectURL(preview.url)
          return
        }
        if (!draftRef.current.attachments.some((entry) => entry.id === attachment.id)) {
          if (preview.transient) URL.revokeObjectURL(preview.url)
          return
        }
        if (preview.transient) transientPreviews.current.set(attachment.id, preview.url)
        setDraft((current) => ({ ...current, attachments: current.attachments.map((entry) =>
          entry.id === attachment.id ? { ...entry, mimeType: source.mimeType,
            ...(!preview.transient ? { previewUrl: preview.url } : {}) } : entry) }))
      }).catch(() => undefined)
    }
    return () => controller.abort()
  }, [storageId])
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
      setDraft((current) => current.body.trim() ? current : { ...current, body: detail.body })
      editorRef.current?.focus()
    }
    const proposalDraft = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          roomId: string
          body: string
          mentions?: string[]
          repositoryId?: string
          rootRequestId?: string
          intent?: Draft['intent']
        }>
      ).detail
      if (detail.roomId !== room.id) return
      setDraft((current) => ({
        ...current,
        body: current.body.trim() ? current.body + '\n' + detail.body : detail.body,
        mentions: [...new Set([...current.mentions, ...(detail.mentions ?? [])])],
        repositoryId: detail.repositoryId ?? current.repositoryId,
        intent: detail.intent ?? current.intent,
        rootRequestId: detail.rootRequestId ?? current.rootRequestId
      }))
      editorRef.current?.focus()
    }
    if (draftId) return
    window.addEventListener('kun-room-example', example)
    window.addEventListener?.('kun-room-continue-topic', continueTopic)
    window.addEventListener?.('kun-room-reply', reply)
    window.addEventListener?.('kun-room-task-reply', taskReply)
    window.addEventListener?.('kun-room-proposal-draft', proposalDraft)
    return () => {
      window.removeEventListener('kun-room-example', example)
      window.removeEventListener?.('kun-room-continue-topic', continueTopic)
      window.removeEventListener?.('kun-room-reply', reply)
      window.removeEventListener?.('kun-room-task-reply', taskReply)
      window.removeEventListener?.('kun-room-proposal-draft', proposalDraft)
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
    window.dispatchEvent?.(new CustomEvent('kun-room-draft-updated', { detail: { roomId: storageId } }))
  }, [draft, storageId])
  const patch = (value: Partial<Draft>): void =>
    setDraft((current) => ({ ...current, ...value, ...(value.mentions ? { mentions: [...new Set(value.mentions)] } : {}) }))

  const submit = async (): Promise<void> => {
    if (
      busy ||
      unavailableMembers.length > 0 ||
      uploads.hasPending() ||
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
      await onSend({ ...content, clientRequestId: requestId }, draft.attachments.map((attachment) => ({ ...attachment,
        previewUrl: attachment.previewUrl?.startsWith('data:image/') ? attachment.previewUrl : undefined })))
      for (const id of transientPreviews.current.keys()) releasePreview(id)
      setDraft(emptyDraft())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const attach = async (files: FileList | null): Promise<void> => {
    if (!files || room.archivedAt || busy) return
    const selected = Array.from(files)
    if (fileRef.current) fileRef.current.value = ''
    await uploads.add(selected, 20 - draftRef.current.attachments.length)
  }

  const disabled = busy || Boolean(room.archivedAt)
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
          attachments={draft.attachments.map((attachment) => ({ ...attachment,
            previewUrl: transientPreviews.current.get(attachment.id) ?? attachment.previewUrl }))}
          taskId={draft.taskId} repositoryId={draft.repositoryId}
          replyToMessageId={replyToMessageId} replyBody={draft.replyBody ?? replyTarget?.body}
          onMentions={(mentions) => patch({ mentions, body: roomUnmarkMentions(draft.body, draft.mentions.filter((id) => !mentions.includes(id))) })}
          onAttachments={(attachments) => {
            const kept = new Set(attachments.map((attachment) => attachment.id))
            for (const id of transientPreviews.current.keys()) if (!kept.has(id)) releasePreview(id)
            patch({ attachments: attachments.map(({ previewUrl, ...attachment }) =>
              previewUrl?.startsWith('blob:') ? attachment : { ...attachment, ...(previewUrl ? { previewUrl } : {}) }) })
          }}
          onTask={() => patch({ taskId: '' })}
          onRepository={() => patch({ repositoryId: '' })}
          onClearReply={() => { patch({ replyToMessageId: undefined, replyBody: undefined, rootRequestId: undefined }); onClearReply?.() }} />
        <RoomAttachmentUploads pending={uploads.pending} onCancel={uploads.cancel} onRetry={uploads.retry} />
        <RoomContentReferenceChips references={draft.references} onChange={(references) => patch({ references })} disabled={disabled} />
        <RoomRichInput ref={editorRef} room={room} value={draft.body} mentions={draft.mentions}
          disabled={disabled} placeholder={t('directPlaceholder', { name: room.name })} onChange={patch}
          onSubmit={() => void submit()} onPasteFiles={(files) => void attach(files)} />
        {pollOpen ? <RoomPollCreator roomId={room.id} replyToMessageId={replyToMessageId}
          onClose={() => setPollOpen(false)} /> : null}
        <input hidden multiple ref={fileRef} type="file"
          onChange={(event) => void attach(event.target.files)} />
        <RoomComposerToolbar room={room} tasks={tasks} taskId={draft.taskId}
          repositoryId={draft.repositoryId} rootRequestId={rootRequestId}
          topicTitle={topicTitle} topicChoices={topicChoices}
          showTopic={!draftId && (room.collaborationMode === 'peer' || Boolean(draft.rootRequestId))}
          intent={draft.intent} busy={busy} uploading={uploading} disabled={disabled}
          attachmentLimit={draft.attachments.length + uploads.pending.length >= 20}
          canSend={uploads.pending.length === 0 && unavailableMembers.length === 0 && Boolean(draft.body.trim() || draft.attachments.length || draft.references.length)}
          onAttach={() => fileRef.current?.click()}
          onMention={() => editorRef.current?.insertText('@')}
          onEmoji={(emoji) => { setTimeout(() => editorRef.current?.insertText(emoji), 0) }} onPoll={() => setPollOpen((value) => !value)}
          onTask={(taskId) => patch({ taskId, executionAgentId: undefined, executionAgentName: undefined })}
          onRepository={(repositoryId) => patch({ repositoryId })}
          onTopic={(id) => patch({ rootRequestId: id || undefined, replyToMessageId: undefined, replyBody: undefined })}
          onIntent={(intent) => patch({ intent })} onStop={onStop} responding={responding} onConnectProject={onConnectProject}
          recipientLabel={sendMentions.length || room.collaborationMode === 'directed'
            ? addressed.map((member) => member.displayName).join(', ') : t('roomsAllMembers')}
          privateControls={compactControls && room.conversationKind === 'user_agent' && !draft.taskId && !draft.executionAgentId
            ? <RoomPermissionPicker roomId={room.id} compact /> : undefined}
          modelControl={modelControl}
          references={<RoomContentReferencePicker showLabel room={room} tasks={tasks} references={draft.references}
            onChange={(references) => patch({ references })} disabled={disabled} />} quickTools={quickTools} />
        <p className="rooms-composer-shortcuts">{t('roomsComposerShortcuts', { defaultValue: 'Enter to send · Shift+Enter for a new line' })}</p>
      </fieldset>
      {!compactControls && room.conversationKind === 'user_agent' && !draft.taskId && !draft.executionAgentId
        ? <RoomPermissionPicker roomId={room.id} /> : null}
      {room.conversationKind !== 'user_agent' && !room.repositories.length ? (
        <p className="rooms-run-note">{t('roomsRepositoryRequiredHint')}</p>
      ) : null}
      {unavailableMembers.length ? (
        <p role="alert" className="mt-2 text-xs text-amber-600">
          {t('roomsSdkUnavailable')} ·{' '}
          {unavailableMembers.map((member) => member.displayName).join(', ')}
        </p>
      ) : null}
      {room.archivedAt ? <p className="rooms-run-note">{t('roomsArchiveHint')}</p> : null}
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
