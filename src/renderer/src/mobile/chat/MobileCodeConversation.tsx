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
import { MobileQueuedMessages } from './MobileQueuedMessages'
import { mergeRestoredDraft } from './mobile-draft-restore'
import { MobileCodeOptions } from './MobileCodeOptions'
import { MobileCodeThreadDetails } from './MobileCodeThreadDetails'
import { MobileMessageActionsSheet } from './MobileMessageActionsSheet'
import { useMobileMessageActionsStore } from '../../stores/mobile-message-actions'
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
    awaitingUserInputThreadIds: value.awaitingUserInputThreadIds,
    queuedMessages: value.queuedMessages, removeQueuedMessage: value.removeQueuedMessage
  })))
  const [draft, setDraft] = useState(() => readBrowserStorageItem(draftKey(threadId)) ?? '')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Which thread this screen shows now; a send rejected after navigating away
  // restores into that thread's stored draft instead of the visible composer.
  const mountedThreadRef = useRef<string | null>(threadId)
  useEffect(() => {
    mountedThreadRef.current = threadId
    return () => { mountedThreadRef.current = null }
  }, [threadId])
  const { activeThreadId, selectThread } = state
  useEffect(() => {
    if (activeThreadId !== threadId) void selectThread(threadId)
  }, [activeThreadId, selectThread, threadId])
  useEffect(() => { setDraft(readBrowserStorageItem(draftKey(threadId)) ?? '') }, [threadId])
  // The actions sheet lives in a global store: leaving the conversation (or
  // switching threads without a remount) must close it, otherwise the next
  // conversation reopens a stale panel whose rollback/fork target the old one.
  useEffect(() => () => useMobileMessageActionsStore.getState().close(), [threadId])
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
  // sendMessage resolves only when the whole turn ends, so the composer clears
  // on submit (like desktop) and only a rejected send puts the draft back.
  const send = (): void => {
    const text = draft.trim()
    if (!threadReady || !hasSubmission) return
    const sentAttachments = attachments.attachments
    setDraft('')
    attachments.clear()
    const restore = (): void => {
      if (mountedThreadRef.current === threadId) {
        setDraft((current) => mergeRestoredDraft(text, current))
        attachments.restore(sentAttachments)
        return
      }
      const key = draftKey(threadId)
      writeBrowserStorageItem(key, mergeRestoredDraft(text, readBrowserStorageItem(key) ?? ''))
    }
    void state.sendMessage(text, state.composerMode, {
      attachments: sentAttachments,
      expectedThreadId: threadId
    }).then((sent) => { if (!sent) restore() }, restore)
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
    <MobileComposer value={draft} onChange={setDraft} onSend={send}
      onStop={() => void state.interrupt()}
      onAttachments={threadReady && attachments.enabled ? () => fileInputRef.current?.click() : null}
      onOptions={null}
      running={threadReady && state.busy} disabled={!threadReady || state.runtimeConnection !== 'ready'}
      sending={attachments.busy}
      attachments={<FloatingComposerAttachments attachments={attachments.attachments}
        attachmentUploadError={attachments.error} onRemoveAttachment={attachments.remove} />}
      pendingActions={threadReady ? <>
        <MobileQueuedMessages messages={state.queuedMessages} onRemove={state.removeQueuedMessage} />
        <MobilePendingActions blocks={state.blocks} resolveApproval={state.resolveApproval}
          resolveUserInput={state.resolveUserInput} />
      </> : null}
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
