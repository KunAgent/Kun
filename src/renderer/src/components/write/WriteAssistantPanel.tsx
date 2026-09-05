import { useEffect, useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  FolderOpen,
  FileText,
  ListTodo,
  Loader2,
  MessageSquareQuote,
  Plus,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AttachmentReference, RuntimeConnectionStatus, ChatBlock } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import type { CoreRuntimeSkillJson } from '../../agent/kun-contract'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { threadSnapshotLooksRunning } from '../../store/chat-store-runtime-helpers'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { selectFocusedPresentationView } from '../../write/write-presentation-view-state'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { FloatingComposer } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import { SubagentReturnBar } from '../chat/message-timeline-empty'
import { WriteAssistantSparkleIcon } from './WriteAssistantIcons'
import { WritePresentationViewChip } from './WritePresentationViewChip'
import { WriteResourceConversationHistoryPopover } from './WriteResourceConversationHistoryPopover'
import { useWriteResourceConversationHistory } from './useWriteResourceConversationHistory'

type Props = {
  input: string
  setInput: (value: string) => void
  mode: 'plan' | 'agent' | 'auto'
  setMode: (value: 'plan' | 'agent' | 'auto') => void
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
  skillCommands?: CoreRuntimeSkillJson[]
  disabledSkillIds?: string[]
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
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onRetryConnection: () => void
  onOpenSettings: () => void
  onConfigureProviders?: () => void
  onNewConversation: () => void
  onPickWorkspace: () => void
  onCollapse: () => void
  className?: string
}

const EMPTY_SKILL_COMMANDS: CoreRuntimeSkillJson[] = []

export function WriteAssistantPanel({
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
  composerModelGroups = [],
  skillCommands = EMPTY_SKILL_COMMANDS,
  disabledSkillIds,
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
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onSend,
  onInterrupt,
  onRetryConnection,
  onOpenSettings,
  onConfigureProviders,
  onNewConversation,
  onPickWorkspace,
  onCollapse,
  className = ''
}: Props): ReactElement {
  const { t } = useTranslation('common')
  // Field-level subscription: keeps the assistant panel from re-rendering on
  // fileContent updates emitted for every keystroke in the editor.
  const {
    workspaceRoot,
    activeFilePath,
    selection,
    quotedSelections,
    quoteCurrentSelection,
    removeQuotedSelection
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoot: s.workspaceRoot,
      activeFilePath: s.activeFilePath,
      selection: s.selection,
      quotedSelections: s.quotedSelections,
      quoteCurrentSelection: s.quoteCurrentSelection,
      removeQuotedSelection: s.removeQuotedSelection
    }))
  )
  const activeFileLabel = activeFilePath
    ? writeRelativeToWorkspace(workspaceRoot, activeFilePath)
    : t('writeNoFileOpen')
  const activeFileName = activeFilePath ? writeBasenameFromPath(activeFilePath) : activeFileLabel
  const presentationView = useWriteWorkspaceStore(selectFocusedPresentationView)
  const [childThreadId, setChildThreadId] = useState<string | null>(null)
  const [childBlocks, setChildBlocks] = useState<ChatBlock[]>([])
  const [childStatus, setChildStatus] = useState<string | undefined>(undefined)
  const [childLoading, setChildLoading] = useState(false)
  const [childError, setChildError] = useState<string | null>(null)
  const viewingChildThread = Boolean(childThreadId)
  const conversationHistory = useWriteResourceConversationHistory(busy)
  const canCreateConversation = runtimeConnection === 'ready' &&
    !busy &&
    !viewingChildThread &&
    !conversationHistory?.running &&
    !conversationHistory?.workflowLocked
  const startNewConversation = (): void => {
    if (!conversationHistory) {
      onNewConversation()
      return
    }
    void conversationHistory.canStartConversation().then((allowed) => {
      if (allowed) onNewConversation()
    })
  }
  const hasParentTimeline =
    blocks.length > 0 || liveReasoning.trim().length > 0 || liveAssistant.trim().length > 0
  const selectionIsReadOnly = selection.sourceKind != null && selection.sourceKind !== 'text'
  const selectionIsSpreadsheet = selection.sourceKind === 'spreadsheet'
  const selectionActionLabel = selectionIsSpreadsheet
    ? t('writeAssistantQuoteSpreadsheetSelection')
    : t(selectionIsReadOnly ? 'writeAssistantExplainPdfSelection' : 'writeAssistantPolishSelection')
  const selectionActionDescription = selectionIsSpreadsheet
    ? selection.charCount > 0
      ? t('writeAssistantQuoteSpreadsheetSelectionActiveSub', {
          sheet: selection.sheetName || t('writeSpreadsheetUnknownSheet'),
          range: selection.cellRange || '—',
          count: selection.charCount
        })
      : t('writeAssistantQuoteSpreadsheetSelectionSub')
    : t(selectionIsReadOnly ? 'writeAssistantExplainPdfSelectionSub' : 'writeAssistantPolishSelectionSub')
  const showSpreadsheetQuoteCandidate =
    !viewingChildThread && selectionIsSpreadsheet && selection.charCount > 0

  useEffect(() => {
    setChildThreadId(null)
    setChildBlocks([])
    setChildStatus(undefined)
    setChildError(null)
  }, [activeFilePath, activeThreadId, workspaceRoot])

  useEffect(() => {
    if (!childThreadId) {
      setChildBlocks([])
      setChildStatus(undefined)
      setChildError(null)
      setChildLoading(false)
      return
    }
    let cancelled = false
    let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    const load = async (): Promise<void> => {
      if (!cancelled) setChildLoading(true)
      try {
        const detail = await getProvider().getThreadDetail(childThreadId)
        if (cancelled) return
        setChildBlocks(detail.blocks)
        setChildStatus(detail.threadStatus)
        setChildError(null)
        if (threadSnapshotLooksRunning(
          detail.blocks,
          detail.threadStatus,
          detail.latestTurnStatus
        )) {
          pollTimer = globalThis.setTimeout(load, 1500)
        }
      } catch (error) {
        if (cancelled) return
        setChildError(error instanceof Error ? error.message : String(error))
        // A queued child can be announced before its side thread is durable.
        // Keep retrying while this local viewer remains open.
        pollTimer = globalThis.setTimeout(load, 1500)
      } finally {
        if (!cancelled) setChildLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      if (pollTimer !== null) globalThis.clearTimeout(pollTimer)
    }
  }, [childThreadId])

  const setAssistantPrompt = (prompt: string): void => {
    setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
  }

  const quoteSelectionForAssistant = (): void => {
    if (!workspaceRoot.trim()) return
    quoteCurrentSelection(workspaceRoot)
    if (!input.trim()) {
      setInput(t(selectionIsReadOnly ? 'writeAssistantExplainPdfSelectionPrompt' : 'writeAssistantPolishSelectionPrompt'))
    }
  }

  const quoteSpreadsheetSelection = (): void => {
    if (!workspaceRoot.trim()) return
    quoteCurrentSelection(workspaceRoot)
  }

  const openChildThread = (threadId: string): void => {
    const targetId = threadId.trim()
    if (!targetId || targetId === childThreadId) return
    setChildBlocks([])
    setChildStatus(undefined)
    setChildError(null)
    setChildThreadId(targetId)
  }

  const closeChildThread = (): void => {
    setChildThreadId(null)
    setChildBlocks([])
    setChildStatus(undefined)
    setChildError(null)
  }

  return (
    <aside
      className={`write-assistant-panel ds-sidebar-surface ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted backdrop-blur-xl ${className}`}
    >
      <div className="write-assistant-header ds-sidebar-surface-chrome shrink-0 border-b border-ds-border-muted">
        <div className="flex h-14 min-w-0 items-center gap-1.5 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <WriteAssistantSparkleIcon className="h-[19px] w-[19px] shrink-0 text-accent" />
            <span className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-ds-ink">
              {t('writeAssistant')}
            </span>
          </div>
          {conversationHistory ? (
            <WriteResourceConversationHistoryPopover
              model={conversationHistory}
              lockedExternally={viewingChildThread}
              onNewConversation={startNewConversation}
            />
          ) : null}
          <button
            type="button"
            onClick={onPickWorkspace}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('writeAssistantChangeWorkspace')}
            title={t('writeAssistantChangeWorkspace')}
          >
            <FolderOpen className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={!canCreateConversation}
            className="ds-sidebar-toggle-button shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('writeAssistantNewConversation')}
            title={t('writeAssistantNewConversation')}
          >
            <Plus className="h-4 w-4" strokeWidth={2.1} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button ml-0.5 shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <X className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
        <div className="min-w-0 border-t border-ds-border-muted/70 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-[11.5px] font-medium text-ds-muted" title={activeFileLabel}>
            <FileText className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
            <span className="shrink-0">{t('writePromptActiveFile')}</span>
            <span className="text-ds-faint" aria-hidden="true">·</span>
            <span className="min-w-0 truncate">{activeFileName}</span>
          </div>
        </div>
      </div>

      <div className="write-assistant-body ds-sidebar-surface-body flex min-h-0 flex-1 flex-col overflow-hidden">
        {viewingChildThread ? (
          <>
            <div
              className="ds-sidebar-surface-chrome shrink-0 border-b border-ds-border-muted/80 px-4 py-3 backdrop-blur-xl"
              data-testid="write-subagent-session-header"
            >
              <div className="flex min-w-0 items-center gap-2">
                <WriteAssistantSparkleIcon className="h-4 w-4 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ds-ink">
                  {t('subagentSessionBannerTitle')}
                </span>
                <span className="max-w-[45%] truncate text-[10.5px] text-ds-faint">
                  {childLoading ? t('designRailChildLoading') : childStatus || childThreadId}
                </span>
              </div>
              {childError ? (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:border-red-800/50 dark:bg-red-500/10 dark:text-red-200">
                  {t('designRailChildError')}: {childError}
                </div>
              ) : null}
            </div>
            <div className="write-assistant-timeline flex min-h-0 flex-1 flex-col overflow-hidden">
              {childLoading && childBlocks.length === 0 ? (
                <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-[12.5px] font-medium text-ds-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={2} />
                  {t('designRailChildLoading')}
                </div>
              ) : childBlocks.length > 0 ? (
                <LazyMessageTimeline
                  blocks={childBlocks}
                  liveReasoning=""
                  live=""
                  activeThreadId={childThreadId}
                  runtimeConnection={runtimeConnection}
                  onRetryConnection={onRetryConnection}
                  onOpenSettings={onOpenSettings}
                  onSelectSuggestion={(text) => setInput(text)}
                  onOpenChildThread={openChildThread}
                  compactCards
                />
              ) : (
                <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-[12.5px] leading-5 text-ds-muted">
                  {t('designRailChildLoading')}
                </div>
              )}
            </div>
          </>
        ) : hasParentTimeline ? (
          <div className="write-assistant-timeline flex min-h-0 flex-1 flex-col overflow-hidden">
            <LazyMessageTimeline
              blocks={blocks}
              liveReasoning={liveReasoning}
              live={liveAssistant}
              activeThreadId={activeThreadId}
              runtimeConnection={runtimeConnection}
              onRetryConnection={onRetryConnection}
              onOpenSettings={onOpenSettings}
              onSelectSuggestion={(text) => setInput(text)}
              onOpenChildThread={openChildThread}
              compactCards
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-5">
            <div className="write-assistant-ready flex flex-col items-center px-3 pb-8 pt-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-accent/12 bg-accent/[0.07] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]">
                <WriteAssistantSparkleIcon className="h-6 w-6" />
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.025em] text-ds-ink">
                {t('writeAssistantEmptyTitle')}
              </h3>
              <p className="mt-2 max-w-[270px] text-[12.5px] leading-5 text-ds-muted">
                {t('writeAssistantEmptySub')}
              </p>
            </div>

            <div className="write-assistant-actions mt-auto overflow-hidden border-y border-ds-border-muted">
              <button
                type="button"
                onClick={() => setAssistantPrompt(t('writeAssistantSummarizePrompt', { file: activeFileLabel }))}
                className="write-assistant-action-row"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <FileText className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ds-ink">{t('writeAssistantSummarize')}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{t('writeAssistantSummarizeSub')}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAssistantPrompt(t('writeAssistantOutlinePrompt', { file: activeFileLabel }))}
                className="write-assistant-action-row border-t border-ds-border-muted"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                  <ListTodo className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ds-ink">{t('writeAssistantOutline')}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{t('writeAssistantOutlineSub')}</span>
                </span>
              </button>
              {!selectionIsSpreadsheet ? (
                <button
                  type="button"
                  onClick={() => {
                    if (selection.charCount > 0) {
                      quoteSelectionForAssistant()
                    } else {
                      setAssistantPrompt(t('writeAssistantPolishSelectionPrompt'))
                    }
                  }}
                  className="write-assistant-action-row border-t border-ds-border-muted"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                    <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-ds-ink">
                      {selectionActionLabel}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                      {selectionActionDescription}
                    </span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="write-assistant-footer ds-sidebar-surface-chrome shrink-0 border-t border-ds-border-muted px-3 pb-3 pt-3">
        {!viewingChildThread && presentationView ? (
          <WritePresentationViewChip view={presentationView} />
        ) : null}
        {showSpreadsheetQuoteCandidate ? (
          <div
            className="mb-3 flex min-w-0 items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[12px] text-ds-muted"
            data-selection-ignore="true"
            data-testid="write-spreadsheet-selection-quote"
          >
            <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" strokeWidth={1.9} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ds-ink">
                {selectionActionLabel}
              </span>
              <span className="block truncate text-[11px] text-ds-faint" title={selectionActionDescription}>
                {selectionActionDescription}
              </span>
            </span>
            <button
              type="button"
              onClick={quoteSpreadsheetSelection}
              className="shrink-0 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-500/25 dark:text-amber-200"
            >
              {t('writeSelectionQuote')}
            </button>
          </div>
        ) : null}
        {!viewingChildThread && quotedSelections.length > 0 ? (
          <div className="mb-3 flex flex-col gap-1.5">
            {quotedSelections.map((quote) => (
              <div
                key={quote.id}
                className="flex min-w-0 items-center gap-2 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-[12px] text-ds-muted"
              >
                <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">
                  {quote.sourceTitle}
                  {(quote.sourceKind === 'pdf' || quote.sourceKind === 'word') && quote.pageStart != null && quote.pageEnd != null
                    ? ` · p.${quote.pageStart === quote.pageEnd ? quote.pageStart : `${quote.pageStart}-${quote.pageEnd}`}`
                    : quote.sourceKind === 'presentation' && quote.slide != null
                      ? ` · Slide ${quote.slide}`
                      : quote.sourceKind === 'spreadsheet' && quote.sheetName && quote.cellRange
                        ? ` · ${quote.sheetName}!${quote.cellRange}`
                    : quote.lineStart != null && quote.lineEnd != null ? ` · ${quote.lineStart}-${quote.lineEnd}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => removeQuotedSelection(quote.id)}
                  className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  title={t('writeRemoveQuote')}
                  aria-label={t('writeRemoveQuote')}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {viewingChildThread ? (
          <SubagentReturnBar
            parentTitle={t('writeAssistant')}
            onBack={closeChildThread}
          />
        ) : (
          <FloatingComposer
            variant="compact"
            workspaceRootOverride={workspaceRoot}
            input={input}
            setInput={setInput}
            mode={mode}
            setMode={setMode}
            busy={busy}
            runtimeReady={runtimeConnection === 'ready'}
            hasActiveThread={Boolean(activeThreadId)}
            composerModel={composerModel}
            composerProviderId={composerProviderId}
            composerPickList={composerPickList}
            composerModelGroups={composerModelGroups}
            skillCommands={skillCommands}
            disabledSkillIds={disabledSkillIds}
            composerReasoningEffort={composerReasoningEffort}
            composerFastMode={composerFastMode}
            onComposerModelChange={setComposerModel}
            onComposerReasoningEffortChange={setComposerReasoningEffort}
            onComposerFastModeChange={setComposerFastMode}
            modelPickerMode="combobox"
            modelControlVariant="split"
            showProviderInModelLabel
            queuedMessages={queuedMessages}
            onRemoveQueuedMessage={removeQueuedMessage}
            onGuideQueuedMessage={guideQueuedMessage}
            attachments={attachments}
            attachmentUploadEnabled={attachmentUploadEnabled}
            attachmentUploadBusy={attachmentUploadBusy}
            attachmentUploadError={attachmentUploadError}
            onPickAttachments={onPickAttachments}
            onPasteClipboardImage={onPasteClipboardImage}
            onRemoveAttachment={onRemoveAttachment}
            onSend={onSend}
            onInterrupt={onInterrupt}
            onConfigureProviders={onConfigureProviders}
          />
        )}
      </div>
    </aside>
  )
}
