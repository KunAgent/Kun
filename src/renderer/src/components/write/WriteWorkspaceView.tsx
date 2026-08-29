import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Eye,
  FileCode2,
  Type
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteExportFormat } from '@shared/write-export'
import { useChatStore } from '../../store/chat-store'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import {
  useWriteWorkspaceStore,
  type WritePreviewMode,
  type WriteSaveStatus,
  writeBasenameFromPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { getWriteRenderSafety } from '../../write/write-render-safety'
import { resolveWriteQuickActions } from '../../write/quick-actions'
import type { WriteRichEditorHandle } from '../../write/tiptap/WriteRichEditor'
import { useWriteWorkspaceLifecycle } from './use-write-workspace-lifecycle'
import { WriteWorkspaceEmptyState } from './WriteWorkspaceEmptyState'
import { WriteWorkspaceToolbar } from './WriteWorkspaceToolbar'
import { WriteInlineAgent } from './WriteInlineAgent'
import { resolveWriteAgentPreset } from '../../write/agent-presets'
import type { WriteMarkdownEditorHandle } from './WriteMarkdownEditor'
import {
  WRITE_RICH_CLIPBOARD_ACTION,
  formatSaveLabel,
  isInlineCompletionToggleShortcut,
  inlineAgentPosition,
  isMarkdownFile,
  computeWriteDocumentStats,
  type WriteNotice
} from './write-workspace-view-utils'
import { isPresentationMarkdownPath } from '../../write/write-presentation'
import {
  isWriteFocusModeFormControl,
  writeFocusModeFloatingLayerClassName,
  writeFocusModeShellClassName
} from '../../write/write-focus-mode'
import {
  getWriteOnboardingDecision,
  readWriteOnboardingComplete,
  writeWriteOnboardingComplete
} from '../../write/write-onboarding'
import { createWriteWorkspaceInlineActions } from './write-workspace-inline-actions'
import { createWriteWorkspaceFileActions } from './write-workspace-file-actions'
import { useWriteWorkspaceViewEffects } from './use-write-workspace-view-effects'
import { WriteEditorGroups } from './WriteEditorGroups'
import { WriteNodeGraphSurface } from './WriteNodeGraphSurface'
import { useNodeGraphStore } from '../../node-graph/node-graph-store'
import { useWriteEditorGroupFileWatches } from './use-write-editor-group-file-watches'
import { shouldShowWriteInlineAgent } from './write-inline-agent-visibility'

type Props = {
  leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void
  input: string; setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  onOpenAgentSettings?: () => void
}

export function WriteWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt,
  onOpenAgentSettings
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const workGraphOpen = useNodeGraphStore((s) => s.workGraphOpen)
  const toggleWorkGraph = useNodeGraphStore((s) => s.toggleWorkGraph)
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const busy = useChatStore((s) => s.busy)
  // Field-level subscription: this view must follow fileContent, but it should
  // not re-render for sidebar-only state such as the directory tree or quoted
  // selections.
  const {
    defaultWorkspaceRoot,
    workspaceRoots,
    settingsLoading,
    settingsError,
    workspaceRoot,
    editorLayout,
    activeFilePath,
    activeFileKind,
    autoSaveEnabled,
    autoSaveDelayMs,
    rootDirectory,
    entriesByDir,
    loadingDirs,
    treeError,
    inlineCompletion,
    inlineCompletionApiReady,
    selectionAssist,
    imageGenReady,
    fileContent,
    fileSize,
    fileTruncated,
    fileError,
    fileLoading,
    saveStatus,
    previewMode,
    selection,
    recentEdits,
    loadWriteSettings,
    setInlineCompletionEnabled,
    addWriteWorkspace,
    setFileContent,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk,
    flushSave,
    createFile,
    refreshWorkspace,
    setFileError,
    setPreviewMode,
    setAssistantOpen,
    setSelection,
    recordRecentEdits,
    quoteCurrentSelection,
    agentPresets,
    assistantAgentPresetId,
    setAssistantAgentPresetId,
    pendingAgentReview,
    clearPendingAgentReview,
    reviewActive,
    setReviewActive,
    saveAllDocuments
  } = useWriteWorkspaceStore(
    useShallow((s) => ({
      defaultWorkspaceRoot: s.defaultWorkspaceRoot,
      workspaceRoots: s.workspaceRoots,
      settingsLoading: s.settingsLoading,
      settingsError: s.settingsError,
      workspaceRoot: s.workspaceRoot,
      editorLayout: s.editorLayout,
      activeFilePath: s.activeFilePath,
      activeFileKind: s.activeFileKind,
      autoSaveEnabled: s.autoSaveEnabled,
      autoSaveDelayMs: s.autoSaveDelayMs,
      rootDirectory: s.rootDirectory,
      entriesByDir: s.entriesByDir,
      loadingDirs: s.loadingDirs,
      treeError: s.treeError,
      inlineCompletion: s.inlineCompletion,
      inlineCompletionApiReady: s.inlineCompletionApiReady,
      selectionAssist: s.selectionAssist,
      agentPresets: s.agentPresets,
      assistantAgentPresetId: s.assistantAgentPresetId,
      setAssistantAgentPresetId: s.setAssistantAgentPresetId,
      pendingAgentReview: s.pendingAgentReview,
      clearPendingAgentReview: s.clearPendingAgentReview,
      reviewActive: s.reviewActive,
      setReviewActive: s.setReviewActive,
      imageGenReady: s.imageGenReady,
      fileContent: s.fileContent,
      fileSize: s.fileSize,
      fileTruncated: s.fileTruncated,
      fileError: s.fileError,
      fileLoading: s.fileLoading,
      saveStatus: s.saveStatus,
      previewMode: s.previewMode,
      selection: s.selection,
      recentEdits: s.recentEdits,
      loadWriteSettings: s.loadWriteSettings,
      setInlineCompletionEnabled: s.setInlineCompletionEnabled,
      addWriteWorkspace: s.addWriteWorkspace,
      setFileContent: s.setFileContent,
      syncActiveFileFromDisk: s.syncActiveFileFromDisk,
      syncActiveImageFromDisk: s.syncActiveImageFromDisk,
      flushSave: s.flushSave,
      createFile: s.createFile,
      refreshWorkspace: s.refreshWorkspace,
      setFileError: s.setFileError,
      setPreviewMode: s.setPreviewMode,
      setAssistantOpen: s.setAssistantOpen,
      setSelection: s.setSelection,
      recordRecentEdits: s.recordRecentEdits,
      quoteCurrentSelection: s.quoteCurrentSelection,
      saveAllDocuments: s.saveAllDocuments
    }))
  )
  const saveTimerRef = useRef<number | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const modeMenuRef = useRef<HTMLDivElement | null>(null)
  const editorPaneRef = useRef<HTMLDivElement | null>(null)
  const exportNoticeTimerRef = useRef<number | null>(null)
  const richHandleRef = useRef<WriteRichEditorHandle | null>(null)
  const markdownHandleRef = useRef<WriteMarkdownEditorHandle | null>(null)
  const [pointerSelecting, setPointerSelecting] = useState(false)
  const resolvedAgentPresets = agentPresets.map((preset) => resolveWriteAgentPreset(preset))
  const [inlineEditInFlight, setInlineEditInFlight] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [documentFocusMode, setDocumentFocusMode] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<WriteExportFormat | typeof WRITE_RICH_CLIPBOARD_ACTION | null>(null)
  const [exportNotice, setExportNotice] = useState<WriteNotice | null>(null)
  const [presentationInFlight, setPresentationInFlight] = useState(false)
  const [onboardingComplete, setOnboardingComplete] = useState(readWriteOnboardingComplete)
  const workspaceReady = workspaceRoot.trim().length > 0
  const activeFileIsImage = activeFileKind === 'image'
  const activeFileIsPdf = activeFileKind === 'pdf'
  const activeFileIsOffice = activeFileKind === 'office'
  const activeFileIsCode = activeFileKind === 'code'
  const activeFileIsText = activeFileKind === 'text'
  const activeOfficeSourceFormat = useWriteWorkspaceStore((state) => (
    state.activeFilePath
      ? state.documentsByPath[state.activeFilePath.replace(/\\/g, '/')]?.officePreview?.sourceFormat ?? null
      : null
  ))
  const activeFileIsEditableSpreadsheet = activeFileIsOffice && activeOfficeSourceFormat === 'xlsx'
  const isMarkdown = activeFileIsCode
    ? false
    : activeFilePath && activeFileIsText ? isMarkdownFile(activeFilePath) : true
  const isPresentationSource = activeFileIsText && isPresentationMarkdownPath(activeFilePath)
  const renderSafety = getWriteRenderSafety({
    isMarkdown,
    contentLength: fileContent.length,
    fileSize,
    truncated: fileTruncated
  })
  const richModeActive =
    previewMode === 'rich' && isMarkdown && renderSafety.livePreviewEnabled && activeFileIsText
  const toggleInlineCompletion = useCallback((): void => {
    const writeState = useWriteWorkspaceStore.getState()
    void writeState.setInlineCompletionEnabled(!writeState.inlineCompletion.enabled)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        !activeFileIsText ||
        renderSafety.readOnly ||
        isWriteFocusModeFormControl(event.target) ||
        !isInlineCompletionToggleShortcut(event)
      ) return
      event.preventDefault()
      toggleInlineCompletion()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeFileIsText, renderSafety.readOnly, toggleInlineCompletion])
  const saveLabel = activeFileIsImage
    ? t('writeImagePreview')
    : activeFileIsPdf ? t('writePdfPreview')
    : activeFileIsOffice
      ? activeFileIsEditableSpreadsheet ? formatSaveLabel(saveStatus, t) : t('writeOfficePreview')
    : renderSafety.readOnly ? t('writeReadOnly') : formatSaveLabel(saveStatus, t)
  // Only surface the toolbar once the selection gesture settles: while the
  // pointer is down (dragging to select) it stays hidden to avoid flicker.
  const selectionAction = shouldShowWriteInlineAgent(selection, pointerSelecting)
    ? inlineAgentPosition(selection, { compact: activeFileIsPdf || activeFileIsOffice })
    : null
  const activeFileLabel = activeFilePath
    ? writeRelativeToWorkspace(workspaceRoot, activeFilePath)
    : t('writeNoFileOpen')
  const activeFileName = activeFilePath ? writeBasenameFromPath(activeFilePath) : t('writeStudio')
  const documentStats = useMemo(
    () => (activeFileIsText ? computeWriteDocumentStats(fileContent, isMarkdown) : null),
    [activeFileIsText, fileContent, isMarkdown],
  )
  const documentStatsLabel = documentStats
    ? t('writeDocumentStats', {
        words: documentStats.wordCount,
        characters: documentStats.characterCount
      })
    : null
  const workspacePathLabel = rootDirectory || workspaceRoot
  const workspaceName = workspacePathLabel ? writeBasenameFromPath(workspacePathLabel) : t('writeWorkspace')
  const onboardingDecision = useMemo(() => getWriteOnboardingDecision({
    persistedComplete: onboardingComplete,
    settingsLoading,
    defaultWorkspaceRoot,
    workspaceRoots,
    workspaceRoot,
    rootDirectory,
    entriesByDir,
    loadingDirs,
    activeFilePath
  }), [
    activeFilePath,
    defaultWorkspaceRoot,
    entriesByDir,
    loadingDirs,
    onboardingComplete,
    rootDirectory,
    settingsLoading,
    workspaceRoot,
    workspaceRoots
  ])
  const exportInFlight = exportingFormat !== null
  const presentationEnabled = Boolean(
    workspaceReady &&
    activeFilePath &&
    isPresentationSource &&
    !fileLoading &&
    !fileTruncated &&
    !renderSafety.readOnly &&
    !reviewActive &&
    !busy
  )

  useWriteWorkspaceLifecycle({
    workspaceRoot,
    activeFilePath,
    activeFileIsText,
    activeFileIsImage,
    autoSaveEnabled,
    autoSaveDelayMs,
    fileContent,
    saveStatus,
    workspaceReady,
    readOnly: renderSafety.readOnly,
    reviewActive,
    pendingAgentReview,
    reviewSurfaceKey: previewMode,
    saveTimerRef,
    markdownHandleRef,
    flushSave,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk,
    setFileContent,
    setFileError,
    clearPendingAgentReview,
    setReviewActive
  })
  useWriteEditorGroupFileWatches({ workspaceRoot, editorLayout })

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      const state = useWriteWorkspaceStore.getState()
      const hasDirtyDocuments = Object.values(state.documentsByPath).some(
        (document) => (
          document.kind === 'text' ||
          (document.kind === 'office' && document.officePreview?.sourceFormat === 'xlsx')
        ) && document.saveStatus !== 'saved'
      )
      if (!hasDirtyDocuments) return
      if (state.autoSaveEnabled) void saveAllDocuments(workspaceRoot)
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [saveAllDocuments, workspaceRoot])

  const showExportNotice = (notice: WriteNotice): void => {
    setExportNotice(notice)
  }

  const completeOnboarding = useCallback((): void => {
    writeWriteOnboardingComplete()
    setOnboardingComplete(true)
  }, [])

  const setAssistantPrompt = (prompt: string): void => {
    setAssistantOpen(true)
    setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
  }
  const {
    applyBlockType,
    applyInlineFormat,
    generateInfographic,
    quoteSelectionToAssistant,
    runQuickAction,
    submitInlineEdit
  } = createWriteWorkspaceInlineActions({
    t,
    workspaceReady,
    workspaceRoot,
    activeFilePath,
    renderReadOnly: renderSafety.readOnly,
    richModeActive,
    fileContent,
    selection,
    inlineCompletion,
    recentEdits,
    inlineEditInFlight,
    input,
    setInput,
    onSubmitPrompt,
    richHandleRef,
    markdownHandleRef,
    setAssistantOpen,
    setInlineEditInFlight,
    setFileContent,
    setFileError,
    setSelection,
    recordRecentEdits,
    quoteCurrentSelection,
    showExportNotice
  })

  const {
    copyCurrentFileAsRichText,
    createDraftFile,
    exportCurrentFile,
    generatePresentation,
    pickWriteWorkspace
  } = createWriteWorkspaceFileActions({
    t,
    workspaceReady,
    workspaceRoot,
    rootDirectory,
    activeFilePath,
    activeFileIsText,
    fileContent,
    presentationEnabled,
    presentationInFlight,
    runtimeConnection,
    input,
    setInput,
    onSubmitPrompt,
    saveTimerRef,
    addWriteWorkspace,
    createFile,
    flushSave,
    setAssistantOpen,
    setFileError,
    ensureWriteThreadForWorkspace,
    completeOnboarding,
    showExportNotice,
    setExportMenuOpen,
    setExportingFormat,
    setPresentationInFlight
  })



  useWriteWorkspaceViewEffects({
    loadWriteSettings,
    onboardingComplete,
    onboardingDecision,
    completeOnboarding,
    activeFilePath,
    previewMode,
    editorPaneRef,
    exportMenuRef,
    modeMenuRef,
    exportNoticeTimerRef,
    exportMenuOpen,
    modeMenuOpen,
    exportNotice,
    setExportMenuOpen,
    setModeMenuOpen,
    setPointerSelecting,
    setExportNotice
  })

  if (!workspaceReady) {
    return (
      <WriteWorkspaceEmptyState
        error={settingsError ?? treeError ?? fileError}
        onPickWorkspace={() => void pickWriteWorkspace()}
      />
    )
  }

  // Edit-mode quick actions rewrite the document, so drop them on read-only
  // files; chat-mode actions (which only quote into the sidebar) still apply.
  const inlineQuickActions = resolveWriteQuickActions(selectionAssist.quickActions, t)
    .filter((quickAction) => (
      quickAction.mode !== 'edit' || activeFileIsOffice || (activeFileIsText && !renderSafety.readOnly)
    ))
    .map((quickAction) => activeFileIsOffice
      ? { ...quickAction, mode: 'chat' as const }
      : quickAction)
  const liveModeActive = previewMode === 'live' && renderSafety.livePreviewEnabled
  const sourceModeActive =
    previewMode === 'source' ||
    ((previewMode === 'live' || previewMode === 'rich') && !renderSafety.livePreviewEnabled) ||
    (previewMode === 'rich' && !richModeActive)

  const modeMenuItems: Array<{ mode: WritePreviewMode; label: string; shortLabel: string; icon: ReactElement; active: boolean }> = [
    {
      mode: 'rich',
      label: t('writeModeRich'),
      shortLabel: t('writeModeRich'),
      icon: <Type className="h-4 w-4" strokeWidth={1.85} />,
      active: richModeActive
    },
    {
      mode: 'source',
      label: t('writeModeSource'),
      shortLabel: t('writeModeSource'),
      icon: <FileCode2 className="h-4 w-4" strokeWidth={1.85} />,
      active: sourceModeActive
    },
    {
      mode: 'preview',
      label: t('writeModePreview'),
      shortLabel: t('writeModePreview'),
      icon: <Eye className="h-4 w-4" strokeWidth={1.85} />,
      active: previewMode === 'preview'
    }
  ]

  const focusedToolbar = (
    <WriteWorkspaceToolbar
        embedded
        showSidebarToggle={false}
        activeFileIsImage={activeFileIsImage}
        activeFileIsPdf={activeFileIsPdf}
        activeFileIsOffice={activeFileIsOffice}
        activeFileIsEditableSpreadsheet={activeFileIsEditableSpreadsheet}
        activeFileIsCode={activeFileIsCode}
        activeFileIsText={activeFileIsText}
        activeFileLabel={activeFileLabel}
        activeFileName={activeFileName}
        activeFilePath={activeFilePath ?? ''}
        documentStatsLabel={documentStatsLabel}
        inlineCompletionEnabled={inlineCompletion.enabled}
        exportInFlight={exportInFlight}
        exportMenuOpen={exportMenuOpen}
        exportMenuRef={exportMenuRef}
        leftSidebarCollapsed={leftSidebarCollapsed}
        liveModeActive={liveModeActive}
        modeMenuItems={modeMenuItems}
        modeMenuOpen={modeMenuOpen}
        modeMenuRef={modeMenuRef}
        previewMode={previewMode}
        presentationEnabled={presentationEnabled}
        presentationInFlight={presentationInFlight}
        readOnly={renderSafety.readOnly}
        saveLabel={saveLabel}
        saveStatus={saveStatus}
        reviewActive={reviewActive}
        setExportMenuOpen={setExportMenuOpen}
        setModeMenuOpen={setModeMenuOpen}
        setPreviewMode={setPreviewMode}
        onCopyRichText={() => void copyCurrentFileAsRichText()}
        onExportFile={(format) => void exportCurrentFile(format)}
        onGeneratePresentation={() => void generatePresentation()}
        onSave={() => {
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
          void flushSave(workspaceRoot, { resolveExternalConflict: 'keep-local' })
        }}
        onToggleInlineCompletion={toggleInlineCompletion}
        onToggleLeftSidebar={onToggleLeftSidebar}
      />
  )

  return (
    <div className={`write-workspace-view ds-no-drag flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${documentFocusMode ? 'is-focus-mode' : ''}`}>
      <div className={`min-h-0 min-w-0 flex-1 overflow-hidden ${writeFocusModeShellClassName(documentFocusMode)}`}>
        {workGraphOpen ? (
          <WriteNodeGraphSurface
            workspaceRoot={workspaceRoot}
            leftSidebarCollapsed={leftSidebarCollapsed}
            onToggleLeftSidebar={onToggleLeftSidebar}
            onClose={toggleWorkGraph}
          />
        ) : <WriteEditorGroups
          workspaceName={workspaceName}
          workspacePathLabel={workspacePathLabel}
          workspaceError={settingsError ?? treeError}
          inlineCompletion={inlineCompletion}
          inlineCompletionApiReady={inlineCompletionApiReady}
          leftSidebarCollapsed={leftSidebarCollapsed}
          onToggleLeftSidebar={onToggleLeftSidebar}
          focusMode={documentFocusMode}
          onFocusModeChange={setDocumentFocusMode}
          richHandleRef={richHandleRef}
          markdownHandleRef={markdownHandleRef}
          editorPaneRef={editorPaneRef}
          focusedToolbar={focusedToolbar}
          onboardingDecision={onboardingDecision}
          onAskAssistant={setAssistantPrompt}
          onCreateDraft={() => void createDraftFile()}
          onPickWorkspace={() => void pickWriteWorkspace()}
        />}
      </div>
      {selectionAction && activeFilePath && (activeFileIsText || activeFileIsPdf || activeFileIsOffice) ? (
        <WriteInlineAgent
          action={selectionAction}
          preferAbove={activeFileIsPdf || activeFileIsOffice}
          formattingEnabled={activeFileIsText && isMarkdown && !renderSafety.readOnly}
          onApplyFormat={applyInlineFormat}
          blockType={selection.blockType}
          onSetBlockType={applyBlockType}
          quickActions={inlineQuickActions}
          onQuickAction={runQuickAction}
          onQuoteSelection={quoteSelectionToAssistant}
          agentPresets={resolvedAgentPresets}
          activeAgentId={assistantAgentPresetId}
          onSelectAgent={setAssistantAgentPresetId}
          onOpenAgentSettings={onOpenAgentSettings}
          infographicEnabled={activeFileIsText && imageGenReady && isMarkdown && !renderSafety.readOnly}
          onGenerateInfographic={generateInfographic}
          focusMode={documentFocusMode}
        />
      ) : null}

      {fileError ? (
        <div className={`pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-red-200/70 bg-red-50/92 px-4 py-2 text-[13px] text-red-700 shadow-[0_14px_32px_rgba(20,47,95,0.12)] dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200 ${writeFocusModeFloatingLayerClassName(documentFocusMode, 'z-40')}`}>
          {fileError}
        </div>
      ) : null}
      {exportNotice ? (
        <div
          className={`pointer-events-none fixed left-1/2 -translate-x-1/2 rounded-full border px-4 py-2 text-[13px] shadow-[0_14px_32px_rgba(20,47,95,0.12)] ${writeFocusModeFloatingLayerClassName(documentFocusMode, 'z-40')} ${
            exportNotice.tone === 'error'
              ? 'border-red-200/70 bg-red-50/92 text-red-700 dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200'
              : 'border-emerald-200/80 bg-emerald-50/92 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/84 dark:text-emerald-200'
          }`}
          style={{ bottom: fileError ? 68 : 20 }}
        >
          {exportNotice.message}
        </div>
      ) : null}
    </div>
  )
}
