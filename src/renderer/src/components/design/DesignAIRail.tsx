import { memo, useState, type ReactElement } from 'react'
import { PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AttachmentReference, NormalizedThread, RuntimeConnectionStatus, ChatBlock } from '../../agent/types'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { threadSnapshotLooksRunning } from '../../store/chat-store-runtime-helpers'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { drawingHistoryMutationMatches } from '../../design/design-drawing-history'
import {
  DesignConversationContent,
  DesignConversationHistoryHeader
} from './DesignConversationContent'
import type { DesignComposerContext } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import {
  canClearDesignHistory,
  designHistoryInteractionsLocked,
  hasClearableDesignHistory
} from './design-ai-rail-history'

export {
  canClearDesignHistory,
  designHistoryInteractionsLocked,
  designHistoryMenuEntries,
  designRailHeaderTitle,
  designThreadTitleLooksDefault,
  hasClearableDesignHistory,
  type DesignHistoryMenuEntry
} from './design-ai-rail-history'

type Props = {
  input: string
  setInput: (value: string) => void
  mode: 'plan' | 'agent'
  setMode: (value: 'plan' | 'agent') => void
  busy: boolean
  runtimeConnection: RuntimeConnectionStatus
  activeThreadId: string | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  composerFastMode: boolean
  setComposerModel: (modelId: string, providerId?: string) => void
  setComposerReasoningEffort: (effort: ComposerReasoningEffort) => void
  setComposerFastMode: (enabled: boolean) => void
  queuedMessages: QueuedUserMessage[]
  removeQueuedMessage: (id: string) => void
  guideQueuedMessage: (id: string) => void | Promise<unknown>
  attachments?: AttachmentReference[]
  attachmentUploadEnabled?: boolean
  attachmentUploadBusy?: boolean
  attachmentUploadError?: string | null
  contextChips?: DesignComposerContext[]
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onRemoveContextChip?: (id: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onRetryConnection: () => void
  onOpenSettings: (section?: string) => void
  onConfigureProviders?: () => void
  drawingTitle: string
  onClearHistory: () => void | Promise<void>
  hasRegisteredHistory?: boolean
  designThreads: NormalizedThread[]
  designHistoryThreadIds: string[]
  onSwitchThread: (threadId: string) => void
  onCollapse: () => void
  drawingCreationSubmitting?: boolean
  className?: string
}

function DesignAIRailInner({
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeConnection,
  activeThreadId,
  blocks,
  liveReasoning,
  liveAssistant,
  composerModel,
  composerProviderId,
  composerPickList,
  composerModelGroups,
  composerReasoningEffort,
  composerFastMode,
  setComposerModel,
  setComposerReasoningEffort,
  setComposerFastMode,
  queuedMessages,
  removeQueuedMessage,
  guideQueuedMessage,
  attachments = [],
  attachmentUploadEnabled = false,
  attachmentUploadBusy = false,
  attachmentUploadError = null,
  contextChips = [],
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onRemoveContextChip,
  onSend,
  onInterrupt,
  onRetryConnection,
  onOpenSettings,
  onConfigureProviders,
  drawingTitle,
  onClearHistory,
  hasRegisteredHistory = false,
  designThreads,
  designHistoryThreadIds,
  onSwitchThread,
  onCollapse,
  drawingCreationSubmitting: drawingCreationSubmittingOverride,
  className = ''
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const activeDocumentId = useDesignWorkspaceStore((s) => s.activeDocumentId)
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)
  const storeDrawingCreationSubmitting = useDesignWorkspaceStore((s) => s.drawingCreationSubmitting)
  const drawingCreationSubmitting =
    drawingCreationSubmittingOverride ?? storeDrawingCreationSubmitting
  const drawingHistoryMutation = useDesignWorkspaceStore((s) => s.drawingHistoryMutation)
  const [historyClearing, setHistoryClearing] = useState(false)
  const [viewingChildThread, setViewingChildThread] = useState(false)

  const historyMutationPending = drawingHistoryMutationMatches(
    drawingHistoryMutation,
    workspaceRoot,
    activeDocumentId
  )
  const runActive = Boolean(pagesRun)
  const historyLocked = designHistoryInteractionsLocked({
    historyClearing,
    historyMutationPending
  })
  const designHistoryRunning = designThreads.some((thread) =>
    threadSnapshotLooksRunning([], thread.status) ||
    threadSnapshotLooksRunning([], thread.latestTurnStatus)
  )
  const composerBusy = busy || runActive
  const effectiveBusy = composerBusy || historyLocked || drawingCreationSubmitting
  // Mirror the shared header's entry resolution: when the registry has no
  // ids yet, the visible design threads themselves are the history entries.
  const registeredHistoryThreadIds = designHistoryThreadIds.length > 0
    ? designHistoryThreadIds
    : designThreads.map((thread) => thread.id)
  const showingDocumentThread = Boolean(
    activeThreadId && registeredHistoryThreadIds.includes(activeThreadId)
  )
  const canClearHistory = canClearDesignHistory({
    runtimeConnection,
    busy: effectiveBusy || designHistoryRunning,
    viewingChildThread,
    hasHistory: hasClearableDesignHistory({
      hasRegisteredHistory,
      registeredHistoryCount: Math.max(
        registeredHistoryThreadIds.length,
        hasRegisteredHistory ? 1 : 0
      ),
      designThreads,
      showingDocumentThread,
      blocks,
      liveReasoning,
      liveAssistant
    })
  })

  const clearHistory = async (): Promise<void> => {
    if (!canClearHistory || historyClearing) return
    setHistoryClearing(true)
    try {
      await onClearHistory()
    } finally {
      setHistoryClearing(false)
    }
  }

  return (
    <aside
      className={`design-ai-panel ds-sidebar-surface ds-no-drag relative flex min-h-0 flex-col overflow-hidden border-l border-ds-border-muted text-ds-ink backdrop-blur-xl ${className}`}
    >
      <div className="design-ai-header ds-sidebar-surface-chrome shrink-0 border-b border-ds-border-muted px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            title={t('designRailCollapse')}
            aria-label={t('designRailCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <DesignConversationHistoryHeader
            drawingTitle={drawingTitle}
            designThreads={designThreads}
            designHistoryThreadIds={designHistoryThreadIds}
            activeThreadId={activeThreadId}
            onSwitchThread={onSwitchThread}
            onClearHistory={() => void clearHistory()}
            canClearHistory={canClearHistory}
            historyLocked={historyLocked || viewingChildThread}
          />
        </div>
      </div>
      <DesignConversationContent
        input={input}
        setInput={setInput}
        mode={mode}
        setMode={setMode}
        busy={busy}
        runtimeConnection={runtimeConnection}
        activeThreadId={activeThreadId}
        blocks={blocks}
        liveReasoning={liveReasoning}
        liveAssistant={liveAssistant}
        composerModel={composerModel}
        composerProviderId={composerProviderId}
        composerPickList={composerPickList}
        composerModelGroups={composerModelGroups}
        composerReasoningEffort={composerReasoningEffort}
        composerFastMode={composerFastMode}
        setComposerModel={setComposerModel}
        setComposerReasoningEffort={setComposerReasoningEffort}
        setComposerFastMode={setComposerFastMode}
        queuedMessages={queuedMessages}
        removeQueuedMessage={removeQueuedMessage}
        guideQueuedMessage={guideQueuedMessage}
        attachments={attachments}
        attachmentUploadEnabled={attachmentUploadEnabled}
        attachmentUploadBusy={attachmentUploadBusy}
        attachmentUploadError={attachmentUploadError}
        contextChips={contextChips}
        onPickAttachments={onPickAttachments}
        onPasteClipboardImage={onPasteClipboardImage}
        onRemoveAttachment={onRemoveAttachment}
        onRemoveContextChip={onRemoveContextChip}
        onSend={onSend}
        onInterrupt={onInterrupt}
        onRetryConnection={onRetryConnection}
        onOpenSettings={onOpenSettings}
        onConfigureProviders={onConfigureProviders}
        designThreads={designThreads}
        designHistoryThreadIds={designHistoryThreadIds}
        onSwitchThread={onSwitchThread}
        onViewingChildThreadChange={setViewingChildThread}
        historyClearing={historyClearing}
        drawingCreationSubmitting={drawingCreationSubmitting}
      />
    </aside>
  )
}

export const DesignAIRail = memo(DesignAIRailInner)
