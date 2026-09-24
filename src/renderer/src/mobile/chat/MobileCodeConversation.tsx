import { ArrowLeft, ChevronDown, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import { selectLivePendingUserInput } from '../../components/chat/user-input-panel-logic'
import { sidebarThreadActivity, type SidebarThreadActivityContext } from '../../components/chat/sidebar-project-selectors'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { MobileComposer } from './MobileComposer'
import { MobilePendingActions } from './MobilePendingActions'
import { MobileCodeOptions } from './MobileCodeOptions'
import { MobileCodeThreadDetails } from './MobileCodeThreadDetails'
import { MobileMessageActionsSheet } from './MobileMessageActionsSheet'
import { FloatingComposerAttachments } from '../../components/chat/FloatingComposerAttachments'
import { useMobileCodeAttachments } from './use-mobile-code-attachments'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import './mobile-code-conversation.css'
import './mobile-timeline-overrides.css'

function draftKey(threadId: string): string { return `kun.mobile.code.draft.${threadId}` }

export function mobileCodeThreadReady(activeThreadId: string | null, requestedThreadId: string): boolean {
  return activeThreadId === requestedThreadId
}

export function MobileCodeConversation({ threadId, onBack, onOpenSettings }: {
  threadId: string
  onBack: () => void
  onOpenSettings: () => void
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
    resolveUserInput: value.resolveUserInput,
    watchTurnCompletion: value.watchTurnCompletion, unreadThreadIds: value.unreadThreadIds,
    scheduledThreadActivities: value.scheduledThreadActivities,
    awaitingUserInputThreadIds: value.awaitingUserInputThreadIds
  })))
  const [draft, setDraft] = useState(() => readBrowserStorageItem(draftKey(threadId)) ?? '')
  const [sending, setSending] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
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
  const activityContext: SidebarThreadActivityContext = {
    activeThreadId: state.activeThreadId,
    busy: state.busy,
    watchTurnCompletion: state.watchTurnCompletion ?? {},
    unreadThreadIds: state.unreadThreadIds ?? {},
    scheduledThreadActivities: state.scheduledThreadActivities ?? {},
    awaitingUserInputThreadIds: state.awaitingUserInputThreadIds ?? {}
  }
  const activityKind = thread ? sidebarThreadActivity(thread, activityContext) : 'read'
  const modeLabel = state.composerMode === 'plan' ? t('planMode')
    : state.composerMode === 'agent' ? t('agentMode')
    : t('autoLabel')
  const subtitle = [
    workspaceLabelFromPath(thread?.workspace ?? state.workspaceRoot) || t('mobileCodeProjects'),
    modeLabel,
    state.composerModel || t('autoLabel')
  ].join(' · ')
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
      <button type="button" className="kun-mobile-back" aria-label={t('back')} onClick={onBack}>
        <ArrowLeft size={20} aria-hidden />
      </button>
      <button
        type="button"
        className="kun-mobile-conversation-title"
        onClick={() => setOptionsOpen(true)}
        aria-label={t('mobileConversationOptions')}
      >
        <h1>{thread?.title ?? t('loading')}</h1>
        <span className="kun-mobile-conversation-sub">
          <span className="kun-mobile-status-dot" data-kind={activityKind} aria-hidden />
          <span className="kun-mobile-conversation-meta">{subtitle}</span>
          <ChevronDown size={14} aria-hidden />
        </span>
      </button>
      <button type="button" aria-label={t('mobileMore')} onClick={() => setDetailsOpen(true)}><MoreHorizontal aria-hidden /></button>
    </header>
    <div className="kun-mobile-code-timeline">
      {threadReady ? <LazyMessageTimeline blocks={state.blocks} liveReasoning={state.liveReasoning} live={state.liveAssistant}
        activeThreadId={state.activeThreadId} runtimeConnection={state.runtimeConnection}
        runtimeError={state.runtimeError} onRetryConnection={state.probeRuntime}
        onOpenSettings={onOpenSettings} compactCards surface="mobile" /> : null}
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
      onOptions={null}
      running={threadReady && state.busy} disabled={!threadReady || state.runtimeConnection !== 'ready'}
      sending={sending || attachments.busy}
      attachments={<FloatingComposerAttachments attachments={attachments.attachments}
        attachmentUploadError={attachments.error} onRemoveAttachment={attachments.remove} />}
      pendingActions={threadReady ? <MobilePendingActions blocks={state.blocks} resolveApproval={state.resolveApproval}
        resolveUserInput={state.resolveUserInput} /> : null}
      canSend={hasSubmission}
      labels={{ placeholder: t(pendingInput ? 'mobileInputComposerHint' : 'mobileComposerPlaceholder'), send: t('send'), stop: t('interrupt'),
        attachments: t('toolAttachments') }} />
    <MobileCodeOptions open={optionsOpen} onClose={() => setOptionsOpen(false)}
      model={state.composerModel} providerId={state.composerProviderId} models={state.composerPickList}
      groups={state.composerModelGroups} mode={state.composerMode} reasoning={state.composerReasoningEffort}
      onModel={state.setComposerModel} onMode={state.setComposerMode}
      onReasoning={state.setComposerReasoningEffort} onOpenSettings={onOpenSettings} />
    <MobileCodeThreadDetails threadId={threadId} open={detailsOpen}
      onClose={() => setDetailsOpen(false)} onArchived={onBack} />
    <MobileMessageActionsSheet />
  </section>
}
