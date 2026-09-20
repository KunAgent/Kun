import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import { MobileComposer } from './MobileComposer'
import { MobilePendingActions } from './MobilePendingActions'
import { MobileCodeOptions } from './MobileCodeOptions'
import { FloatingComposerAttachments } from '../../components/chat/FloatingComposerAttachments'
import { useMobileCodeAttachments } from './use-mobile-code-attachments'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import './mobile-code-conversation.css'

function draftKey(threadId: string): string { return `kun.mobile.code.draft.${threadId}` }

export function MobileCodeConversation({ threadId, onBack, onDetails, onSettings }: {
  threadId: string
  onBack: () => void
  onDetails: () => void
  onSettings: () => void
}) {
  const { t } = useTranslation('common')
  const state = useChatStore(useShallow((value) => ({
    activeThreadId: value.activeThreadId, threads: value.threads, blocks: value.blocks,
    liveReasoning: value.liveReasoning, liveAssistant: value.liveAssistant,
    runtimeConnection: value.runtimeConnection, runtimeError: value.runtimeErrorDetail ?? value.error,
    busy: value.busy, composerMode: value.composerMode, composerModel: value.composerModel,
    composerProviderId: value.composerProviderId, composerPickList: value.composerPickList,
    composerModelGroups: value.composerModelGroups, composerReasoningEffort: value.composerReasoningEffort,
    workspaceRoot: value.workspaceRoot,
    setComposerModel: value.setComposerModel, setComposerMode: value.setComposerMode,
    setComposerReasoningEffort: value.setComposerReasoningEffort,
    selectThread: value.selectThread, sendMessage: value.sendMessage, interrupt: value.interrupt,
    probeRuntime: value.probeRuntime, resolveApproval: value.resolveApproval,
    resolveUserInput: value.resolveUserInput
  })))
  const [draft, setDraft] = useState(() => readBrowserStorageItem(draftKey(threadId)) ?? '')
  const [sending, setSending] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { activeThreadId, selectThread } = state
  useEffect(() => {
    if (activeThreadId !== threadId) void selectThread(threadId)
  }, [activeThreadId, selectThread, threadId])
  useEffect(() => { setDraft(readBrowserStorageItem(draftKey(threadId)) ?? '') }, [threadId])
  useEffect(() => { writeBrowserStorageItem(draftKey(threadId), draft) }, [draft, threadId])
  const attachments = useMobileCodeAttachments({
    activeThreadId: state.activeThreadId,
    mode: state.composerMode,
    model: state.composerModel,
    providerId: state.composerProviderId,
    modelGroups: state.composerModelGroups,
    runtimeConnection: state.runtimeConnection,
    workspaceRoot: state.workspaceRoot
  })
  const thread = state.threads.find((item) => item.id === threadId)
  const hasSubmission = Boolean(draft.trim() || attachments.attachments.length)
  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!hasSubmission || sending) return
    setSending(true)
    try {
      if (await state.sendMessage(text, state.composerMode, { attachments: attachments.attachments })) {
        setDraft('')
        attachments.clear()
      }
    } finally { setSending(false) }
  }
  return <section className="kun-mobile-code-conversation">
    <header>
      <button type="button" aria-label={t('back')} onClick={onBack}><ArrowLeft aria-hidden /></button>
      <div><h1>{thread?.title ?? t('loading')}</h1><p>{thread?.workspace ?? state.composerModel}</p></div>
      <button type="button" aria-label={t('more')} onClick={onDetails}><MoreHorizontal aria-hidden /></button>
    </header>
    <div className="kun-mobile-code-timeline">
      <LazyMessageTimeline blocks={state.blocks} liveReasoning={state.liveReasoning} live={state.liveAssistant}
        activeThreadId={state.activeThreadId} runtimeConnection={state.runtimeConnection}
        runtimeError={state.runtimeError} onRetryConnection={state.probeRuntime}
        onOpenSettings={onSettings} compactCards />
    </div>
    <input ref={fileInputRef} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
      onChange={(event) => {
        const files = [...(event.target.files ?? [])]
        event.target.value = ''
        void attachments.pick(files)
      }} />
    <MobileComposer value={draft} onChange={setDraft} onSend={() => void send()}
      onStop={() => void state.interrupt()}
      onAttachments={attachments.enabled ? () => fileInputRef.current?.click() : null}
      onOptions={() => setOptionsOpen(true)}
      running={state.busy} disabled={state.runtimeConnection !== 'ready'}
      sending={sending || attachments.busy}
      attachments={<FloatingComposerAttachments attachments={attachments.attachments}
        attachmentUploadError={attachments.error} onRemoveAttachment={attachments.remove} />}
      pendingActions={<MobilePendingActions blocks={state.blocks} resolveApproval={state.resolveApproval}
        resolveUserInput={state.resolveUserInput} />}
      canSend={hasSubmission}
      labels={{ placeholder: t('composerPlaceholder'), send: t('send'), stop: t('stop'),
        attachments: t('attachments'), options: `${state.composerMode} · ${state.composerModel || t('auto')}` }} />
    <MobileCodeOptions open={optionsOpen} onClose={() => setOptionsOpen(false)}
      model={state.composerModel} providerId={state.composerProviderId} models={state.composerPickList}
      groups={state.composerModelGroups} mode={state.composerMode} reasoning={state.composerReasoningEffort}
      onModel={state.setComposerModel} onMode={state.setComposerMode}
      onReasoning={state.setComposerReasoningEffort} />
  </section>
}
