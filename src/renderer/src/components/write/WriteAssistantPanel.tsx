import { useContext, useEffect, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  FileText,
  GraduationCap,
  Loader2,
  MessageSquareQuote,
  PanelRightClose,
  Plus,
  TextSelect,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AttachmentReference, RuntimeConnectionStatus, ChatBlock } from '../../agent/types'
import type { CoreRuntimeSkillJson } from '../../agent/kun-contract'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { useChatStore } from '../../store/chat-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { openBoundedPaperReading } from '../../paper/paper-reading-entry'
import { usePaperStore } from '../../write/paper/paper-store'
import { paperUnitDirForFile, paperUnitDirFromKnownUnits } from '../../write/paper/paper-unit'
import {
  clearUnreadCompletion,
  completionIsCurrentlyVisible
} from '../../store/unread-completions'
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
import { WriteAssistantEmptyState } from './WriteAssistantEmptyState'
import { WorkHomeHero, WorkHomeSpaceChip, WorkHomeStarters, WorkKunAvatar } from './WorkHomeEmptyState'
import { useWorkConversationStage, WorkStageChromeContext } from '../../write/work-conversation-stage'
import { focusedPaperViewId } from '../../paper/paper-view'
import type { WritePaperViewId } from '../../write/write-workspace-store-types'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { useWorkSidebarStore } from '../../write/work-sidebar-store'
import { workSessionDisplayTitle } from '../../write/work-sessions-model'
import { prepareWorkSessionForSend } from '../../write/work-session-actions'
import './work-stage.css'
import { WritePresentationViewChip } from './WritePresentationViewChip'
import { WriteResourceConversationHistoryPopover } from './WriteResourceConversationHistoryPopover'
import { useWriteResourceConversationHistory } from './useWriteResourceConversationHistory'
import { useChildThreadViewer } from './useChildThreadViewer'

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

/** Context chip label for a library/discover page, which opens no file. */
const PAPER_VIEW_LABEL_KEYS: Record<WritePaperViewId, string> = {
  library: 'workSidebarLibrary',
  'discover:search': 'writePaperDiscoverTab_search',
  'discover:arxiv': 'writePaperDiscoverNav_arxiv',
  'discover:venue': 'writePaperDiscoverNav_venue',
  'discover:feeds': 'writePaperDiscoverNav_feeds'
}

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
    removeQuotedSelection,
    workSurface
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoot: s.workspaceRoot,
      activeFilePath: s.activeFilePath,
      selection: s.selection,
      quotedSelections: s.quotedSelections,
      quoteCurrentSelection: s.quoteCurrentSelection,
      removeQuotedSelection: s.removeQuotedSelection,
      workSurface: s.workSurface
    }))
  )
  const papersSurface = workSurface === 'papers'
  // Nothing open: the panel is the center stage (Code-like home/conversation).
  const stage = useWorkConversationStage()
  const stageChrome = useContext(WorkStageChromeContext)
  const sessionHeader = useWorkSidebarStore((s) => s.view === 'sessions') || stage
  const sessionTitle = useChatStore((s) =>
    workSessionDisplayTitle(s.threads.find((thread) => thread.id === s.activeThreadId)?.title))
  const paperEntries = usePaperModeStore((s) => s.entries)
  const readerPage = usePaperModeStore((s) => s.readerPage)
  const knownUnits = usePaperStore((s) => s.unitsByDir)
  // Active paper unit (relative dir) resolved against the library index and
  // the store's known units — drives the context header, the composer chip,
  // and the papers-only empty-state prompts.
  const activeUnitRel = (() => {
    if (!papersSurface || !activeFilePath || !workspaceRoot) return null
    const abs = paperUnitDirFromKnownUnits(
      workspaceRoot,
      activeFilePath,
      paperEntries.map((e) => e.unitDir)
    ) ?? paperUnitDirFromKnownUnits(
      workspaceRoot,
      activeFilePath,
      Object.keys(knownUnits)
    )
    return abs ? paperUnitDirForFile(abs, workspaceRoot) : null
  })()
  const activePaperEntry = activeUnitRel
    ? paperEntries.find((e) => e.unitDir === activeUnitRel) ?? null
    : null
  const paperContextLabel = activePaperEntry?.meta.title ?? null
  const activeFileLabel = activeFilePath
    ? writeRelativeToWorkspace(workspaceRoot, activeFilePath)
    : t('writeNoFileOpen')
  const paperView = useWriteWorkspaceStore(focusedPaperViewId)
  const activeFileName = activeFilePath
    ? writeBasenameFromPath(activeFilePath)
    : paperView ? t(PAPER_VIEW_LABEL_KEYS[paperView]) : activeFileLabel
  const presentationView = useWriteWorkspaceStore(selectFocusedPresentationView)
  const {
    childThreadId,
    childBlocks,
    childStatus,
    childLoading,
    childError,
    viewingChildThread,
    openChildThread,
    closeChildThread
  } = useChildThreadViewer(`${activeFilePath ?? ''}\u0000${activeThreadId ?? ''}\u0000${workspaceRoot}`)
  const conversationHistory = useWriteResourceConversationHistory(busy)

  useEffect(() => {
    const threadId = childThreadId?.trim() || activeThreadId?.trim() || null
    useChatStore.getState().setWriteAssistantVisibleThreadId(threadId)
    if (threadId) {
      useChatStore.setState((state) => ({
        unreadThreadIds: completionIsCurrentlyVisible(state, threadId)
          ? clearUnreadCompletion(state.unreadThreadIds, threadId)
          : state.unreadThreadIds
      }))
    }
    return () => {
      const state = useChatStore.getState()
      if (state.writeAssistantVisibleThreadId === threadId) {
        state.setWriteAssistantVisibleThreadId(null)
      }
    }
  }, [activeThreadId, childThreadId])

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
  const home = stage && !hasParentTimeline && !viewingChildThread
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

  return (
    <aside
      className={`write-assistant-panel ds-sidebar-surface ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted backdrop-blur-xl ${stage ? 'is-stage ' : ''}${home ? 'is-home ' : ''}${className}`}
      data-work-assistant={stage ? 'stage' : 'panel'}
    >
      <div className="write-assistant-header ds-sidebar-surface-chrome relative shrink-0">
        <div className="flex h-[52px] min-w-0 items-center gap-1 border-b border-ds-border-muted pl-4 pr-2.5">
          {stage && stageChrome ? (
            <div className={`mr-1.5 flex shrink-0 items-center ${stageChrome.leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
              <SidebarTitlebarToggleButton
                onClick={stageChrome.onToggleLeftSidebar}
                title={stageChrome.leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={stageChrome.leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
            </div>
          ) : null}
          <WorkKunAvatar variant={papersSurface ? 'researcher' : 'writer'} size={22} />
          {sessionHeader ? (
            <span className="write-assistant-session-title ml-2 text-[14px] font-semibold tracking-[-0.01em] text-ds-ink"
              data-placeholder={sessionTitle ? undefined : 'true'} title={sessionTitle || t('workSessionNew')}>
              {sessionTitle || t('workSessionNew')}
            </span>
          ) : (
            // The files view names a titled conversation too; only an unnamed one reads as the assistant.
            <span className="ml-2 min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-ds-ink"
              title={sessionTitle || t('writeAssistant')}>
              {sessionTitle || t('writeAssistant')}
            </span>
          )}
          {/* In the sessions view the sidebar already lists every session. */}
          {conversationHistory && !sessionHeader ? (
            <WriteResourceConversationHistoryPopover
              model={conversationHistory}
              lockedExternally={viewingChildThread}
              onNewConversation={startNewConversation}
            />
          ) : null}
          <button
            type="button"
            onClick={startNewConversation}
            disabled={!canCreateConversation}
            className="write-panel-icon-button disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('writeAssistantNewConversation')}
            title={t('writeAssistantNewConversation')}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
          </button>
          {stage ? null : (
            <button
              type="button"
              onClick={onCollapse}
              className="write-panel-icon-button"
              aria-label={t('rightPanelCollapse')}
              title={t('rightPanelCollapse')}
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <div className="write-assistant-context flex min-w-0 items-center gap-1.5 border-b border-ds-border-muted px-4 py-2.5">
          <span className="write-context-chip min-w-0" title={paperContextLabel ?? activeFileLabel}>
            {papersSurface && (activePaperEntry || paperView) ? (
              <GraduationCap className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            )}
            <span className="sr-only">
              {papersSurface ? t('writePaperContextPaper') : t('writePromptActiveFile')}
            </span>
            <span className="min-w-0 truncate">
              {papersSurface && paperContextLabel ? paperContextLabel : activeFileName}
            </span>
            {papersSurface && readerPage ? (
              <span className="shrink-0 opacity-70">
                p.{readerPage.page}/{readerPage.pageCount || '–'}
              </span>
            ) : null}
          </span>
          {selection.charCount > 0 && !viewingChildThread ? (
            <span className="write-context-chip is-accent shrink-0">
              <TextSelect className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              {t('workAssistantSelectionChip', { count: selection.charCount })}
            </span>
          ) : null}
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
              compactCards={!stage}
            />
          </div>
        ) : stage ? (
          <WorkHomeHero />
        ) : (
          <WriteAssistantEmptyState
            papersSurface={papersSurface}
            paperContextLabel={paperContextLabel}
            activeFileLabel={activeFileLabel}
            selectionCharCount={selection.charCount}
            selectionIsSpreadsheet={selectionIsSpreadsheet}
            selectionActionLabel={selectionActionLabel}
            selectionActionDescription={selectionActionDescription}
            setAssistantPrompt={setAssistantPrompt}
            quoteSelectionForAssistant={quoteSelectionForAssistant}
            t={t}
          />
        )}
      </div>

      <div className="write-assistant-footer ds-sidebar-surface-chrome shrink-0 border-t border-ds-border-muted px-3 pb-3 pt-3">
        {!viewingChildThread && papersSurface && activePaperEntry && readerPage
          && readerPage.unitDir === activeUnitRel ? (
          <div
            className="mb-3 flex min-w-0 items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-[12px] text-ds-muted"
            data-testid="write-paper-context-chip"
          >
            <GraduationCap className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">
              {activePaperEntry.meta.title}
            </span>
            <span className="shrink-0 text-[11px] text-ds-faint">
              p.{readerPage.page}/{readerPage.pageCount || '–'}
            </span>
          </div>
        ) : null}
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
        {home ? <WorkHomeSpaceChip /> : null}
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
            // The home invites like Code's; a docked draft keeps the short prompt.
            placeholderOverride={home ? t('workHomeComposerPlaceholder') : activeThreadId ? undefined : t('placeholder')}
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
            onSend={() => {
              if (papersSurface && activeUnitRel && !viewingChildThread) {
                void openBoundedPaperReading({ workspaceRoot, unitDir: activeUnitRel, meta: activePaperEntry?.meta, question: input })
              } else {
                // A draft or empty home becomes a new session before the turn.
                void prepareWorkSessionForSend().then((ready) => { if (ready) onSend() })
              }
            }}
            onInterrupt={onInterrupt}
            onConfigureProviders={onConfigureProviders}
          />
        )}
        {home ? <WorkHomeStarters onPrompt={setAssistantPrompt} /> : null}
      </div>
    </aside>
  )
}
