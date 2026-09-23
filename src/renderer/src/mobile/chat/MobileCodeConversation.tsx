import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import { selectLivePendingUserInput } from '../../components/chat/user-input-panel-logic'
import { MobileComposer } from './MobileComposer'
import { MobilePendingActions } from './MobilePendingActions'
import { MobileCodeOptions } from './MobileCodeOptions'
import { MobileCodeThreadDetails } from './MobileCodeThreadDetails'
import { MobileCodeSettings } from './MobileCodeSettings'
import { FloatingComposerAttachments } from '../../components/chat/FloatingComposerAttachments'
import { useMobileCodeAttachments } from './use-mobile-code-attachments'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import './mobile-code-conversation.css'

function draftKey(threadId: string): string { return `kun.mobile.code.draft.${threadId}` }

export function mobileCodeThreadReady(activeThreadId: string | null, requestedThreadId: string): boolean {
  return activeThreadId === requestedThreadId
}

export function MobileCodeConversation({ threadId, onBack }: {
  threadId: string
  onBack: () => void
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { activeThreadId, selectThread } = state
  useEffect(() => {
    if (activeThreadId !== threadId) void selectThread(threadId)
  }, [activeThreadId, selectThread, threadId])
  useEffect(() => { setDraft(readBrowserStorageItem(draftKey(threadId)) ?? '') }, [threadId])
  useEffect(() => { writeBrowserStorageItem(draftKey(threadId), draft) }, [draft, threadId])
  const threadReady = mobileCodeThreadReady(state.activeThreadId, threadId)
  const attachments = useMobileCodeAttachments({
    activeThreadId: threadReady ? threadId : null,
    mode: state.composerMode,
    model: state.composerModel,
    providerId: state.composerProviderId,
    modelGroups: state.composerModelGroups,
    runtimeConnection: state.runtimeConnection,
    workspaceRoot: state.workspaceRoot
  })
  const thread = state.threads.find((item) => item.id === threadId)
  const pendingInput = threadReady && selectLivePendingUserInput(state.blocks)
  const hasSubmission = !pendingInput && Boolean(draft.trim() || attachments.attachments.length)
  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!threadReady || !hasSubmission || sending) return
    setSending(true)
    try {
      if (await state.sendMessage(text, state.composerMode, {
        attachments: attachments.attachments,
        expectedThreadId: threadId
      })) {
        setDraft('')
        attachments.clear()
      }
    } finally { setSending(false) }
  }
  return <section className="kun-mobile-code-conversation">
    <header>
      <button type="button" aria-label={t('back')} onClick={onBack}><ArrowLeft aria-hidden /></button>
      <div><h1>{thread?.title ?? t('loading')}</h1><p>{thread?.workspace ?? state.composerModel}</p></div>
      <button type="button" aria-label={t('mobileMore')} onClick={() => setDetailsOpen(true)}><MoreHorizontal aria-hidden /></button>
    </header>
    <div className="kun-mobile-code-timeline">
      {threadReady ? <LazyMessageTimeline blocks={state.blocks} liveReasoning={state.liveReasoning} live={state.liveAssistant}
        activeThreadId={state.activeThreadId} runtimeConnection={state.runtimeConnection}
        runtimeError={state.runtimeError} onRetryConnection={state.probeRuntime}
        onOpenSettings={() => setSettingsOpen(true)} compactCards /> : null}
    </div>
    <input ref={fileInputRef} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
      onChange={(event) => {
        const files = [...(event.target.files ?? [])]
        event.target.value = ''
        void attachments.pick(files)
      }} />
    <MobileComposer value={draft} onChange={setDraft} onSend={() => void send()}
      onStop={() => void state.interrupt()}
      onAttachments={threadReady && attachments.enabled ? () => fileInputRef.current?.click() : null}
      onOptions={() => setOptionsOpen(true)}
      running={threadReady && state.busy} disabled={!threadReady || state.runtimeConnection !== 'ready'}
      sending={sending || attachments.busy}
      attachments={<FloatingComposerAttachments attachments={attachments.attachments}
        attachmentUploadError={attachments.error} onRemoveAttachment={attachments.remove} />}
      pendingActions={threadReady ? <MobilePendingActions blocks={state.blocks} resolveApproval={state.resolveApproval}
        resolveUserInput={state.resolveUserInput} /> : null}
      canSend={hasSubmission}
      labels={{ placeholder: t(pendingInput ? 'mobileInputComposerHint' : 'mobileComposerPlaceholder'), send: t('send'), stop: t('interrupt'),
        attachments: t('toolAttachments'), options: `${state.composerMode === 'plan' ? t('planMode') : state.composerMode === 'agent' ? t('agentMode') : t('autoLabel')} · ${state.composerModel || t('autoLabel')}` }} />
    <MobileCodeOptions open={optionsOpen} onClose={() => setOptionsOpen(false)}
      model={state.composerModel} providerId={state.composerProviderId} models={state.composerPickList}
      groups={state.composerModelGroups} mode={state.composerMode} reasoning={state.composerReasoningEffort}
      onModel={state.setComposerModel} onMode={state.setComposerMode}
      onReasoning={state.setComposerReasoningEffort} />
    <MobileCodeThreadDetails threadId={threadId} open={detailsOpen}
      onClose={() => setDetailsOpen(false)} onArchived={onBack} />
    <MobileCodeSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </section>
}
