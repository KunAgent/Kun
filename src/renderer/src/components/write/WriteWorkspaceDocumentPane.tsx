import { lazy, Suspense, useCallback, useEffect, useRef, type MutableRefObject, type ReactElement, type RefObject } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteInlineCompletionSettingsV1 } from '@shared/app-settings'
import type { WriteRenderSafety } from '../../write/write-render-safety'
import type { WriteRecentEdit } from '../../write/recent-edits'
import {
  WriteRichEditor,
  type WriteRichEditorHandle
} from '../../write/tiptap/WriteRichEditor'
import type { WriteEditorSelectionState, WriteMarkdownEditorHandle } from './WriteMarkdownEditor'
import { WriteMarkdownEditor } from './WriteMarkdownEditor'
import { WriteMarkdownPreview } from './WriteMarkdownPreview'
import { WriteWorkspaceStart } from './WriteWorkspaceStart'
import { WriteImagePreview } from './WriteImagePreview'
import { WritePdfViewer } from './WritePdfViewer'
import { WorkspaceOfficePreview } from '../WorkspaceOfficePreview'
import { WorkspaceCodePreview } from '../WorkspaceCodePreview'
import type {
  WorkspaceOfficePreviewSuccess,
  WorkspacePresentationViewReference,
  WorkspacePresentationViewSource
} from '@shared/office-document'
import type { WorkspaceSpreadsheetMutation } from '@shared/workspace-spreadsheet'
import { writeSelectionFromOffice } from '../../write/write-office-selection'
import {
  isWriteFocusModeFormControl,
  isWriteFocusModeShortcut
} from '../../write/write-focus-mode'

type Props = {
  activeFilePath: string | null
  documentEpoch: number
  activeFileIsImage: boolean
  activeFileIsPdf: boolean
  activeFileIsOffice?: boolean
  activeFileIsCode?: boolean
  activeFileIsText: boolean
  fileLoading: boolean
  fileContent: string
  imageDataUrl: string
  imageMimeType: string
  pdfDataBase64: string
  pdfMimeType: string
  pdfMtimeMs: number
  officePreview?: WorkspaceOfficePreviewSuccess | null
  officeLoading?: boolean
  officeRefreshError?: string | null
  officeAgentEditing?: boolean
  spreadsheetMutations?: WorkspaceSpreadsheetMutation[]
  spreadsheetSourceSha256?: string
  spreadsheetCommitRevision?: number
  spreadsheetUnsupportedReason?: string | null
  spreadsheetSaveError?: string | null
  spreadsheetConflict?: boolean
  spreadsheetConflictTargets?: string[]
  fileSize: number
  workspaceRoot: string
  workspaceName: string
  workspacePathLabel: string
  workspaceError?: string | null
  renderSafety: WriteRenderSafety
  fileGuardMessage: string
  fileGuardDetail: string
  editorVisible: boolean
  previewVisible: boolean
  editorWidth: string
  previewWidth: string
  editorAppearance: 'source' | 'live'
  richModeActive: boolean
  richHandleRef: MutableRefObject<WriteRichEditorHandle | null>
  markdownHandleRef?: MutableRefObject<WriteMarkdownEditorHandle | null>
  debouncedPreviewContent: string
  isMarkdown: boolean
  inlineCompletion: WriteInlineCompletionSettingsV1
  inlineCompletionApiReady: boolean
  recentEdits: WriteRecentEdit[]
  editorPaneRef: RefObject<HTMLDivElement | null>
  previewPaneRef: RefObject<HTMLDivElement | null>
  onAskAssistant: (prompt: string) => void
  onCreateDraft: () => void
  onCreateWhiteboard?: () => void
  onPickWorkspace: () => void
  onRefreshWorkspace: () => void
  onContentChange: (content: string) => void
  onDocumentEdit: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onImagePasteSaved: () => void
  onImagePasteError: (message: string) => void
  onPresentationViewChange: (
    view: WorkspacePresentationViewReference | null,
    source: WorkspacePresentationViewSource
  ) => void
  onSpreadsheetMutations?: (
    mutations: WorkspaceSpreadsheetMutation[],
    unsupportedReason?: string,
    baseFingerprints?: Record<string, string>
  ) => void
  onConvertSpreadsheet?: () => void
  onReloadSpreadsheetConflict?: () => void
  onResolveSpreadsheetConflict?: (decision: 'keep-local' | 'use-external') => void
  onMarkdownReviewStateChange?: (active: boolean) => void
  focused: boolean
  focusMode: boolean
  onFocusModeChange: (active: boolean) => void
  onboarding?: boolean
  workspaceLoading?: boolean
}

const WorkspaceUniverSpreadsheetEditor = lazy(async () => {
  const module = await import('../WorkspaceUniverSpreadsheetEditor')
  return { default: module.WorkspaceUniverSpreadsheetEditor }
})

export function WriteWorkspaceDocumentPane({
  activeFilePath,
  documentEpoch,
  activeFileIsImage,
  activeFileIsPdf,
  activeFileIsOffice = false,
  activeFileIsCode = false,
  activeFileIsText,
  fileLoading,
  fileContent,
  imageDataUrl,
  imageMimeType,
  pdfDataBase64,
  pdfMimeType: _pdfMimeType,
  pdfMtimeMs,
  officePreview = null,
  officeLoading = false,
  officeRefreshError = null,
  officeAgentEditing = false,
  spreadsheetMutations = [],
  spreadsheetSourceSha256 = '',
  spreadsheetCommitRevision = 0,
  spreadsheetUnsupportedReason = null,
  spreadsheetSaveError = null,
  spreadsheetConflict = false,
  spreadsheetConflictTargets = [],
  fileSize,
  workspaceRoot,
  workspaceName,
  workspacePathLabel,
  workspaceError,
  renderSafety,
  fileGuardMessage,
  fileGuardDetail,
  editorVisible,
  previewVisible,
  editorWidth,
  previewWidth,
  editorAppearance,
  richModeActive,
  richHandleRef,
  markdownHandleRef,
  debouncedPreviewContent,
  isMarkdown,
  inlineCompletion,
  inlineCompletionApiReady,
  recentEdits,
  editorPaneRef,
  previewPaneRef,
  onAskAssistant,
  onCreateDraft,
  onCreateWhiteboard,
  onPickWorkspace,
  onRefreshWorkspace,
  onContentChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onImagePasteSaved,
  onImagePasteError,
  onPresentationViewChange,
  onSpreadsheetMutations,
  onConvertSpreadsheet,
  onReloadSpreadsheetConflict,
  onResolveSpreadsheetConflict,
  onMarkdownReviewStateChange,
  focused,
  focusMode,
  onFocusModeChange,
  onboarding = false,
  workspaceLoading = false
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const selectionCallbackRef = useRef(onSelectionChange)
  selectionCallbackRef.current = onSelectionChange
  const handleOfficeSelection = useCallback((next: import('@shared/office-document').WorkspaceOfficeSelection) => {
    selectionCallbackRef.current(writeSelectionFromOffice(next))
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        activeFileIsText &&
        !isWriteFocusModeFormControl(event.target) &&
        isWriteFocusModeShortcut(event)
      ) {
        event.preventDefault()
        onFocusModeChange(!focusMode)
        return
      }
      if (focusMode && event.key === 'Escape' && !event.defaultPrevented) {
        onFocusModeChange(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeFileIsText, focusMode, onFocusModeChange])

  useEffect(() => {
    if (!activeFileIsText && focusMode) onFocusModeChange(false)
  }, [activeFileIsText, focusMode, onFocusModeChange])

  if (!activeFilePath) {
    if (workspaceLoading) {
      return (
        <div className="flex h-full min-h-[320px] items-center justify-center text-[14px] text-ds-muted">
          {t('writeWorkspaceLoading')}
        </div>
      )
    }
    return (
      <WriteWorkspaceStart
        workspaceName={workspaceName}
        workspacePathLabel={workspacePathLabel}
        error={workspaceError}
        onAskAssistant={onAskAssistant}
        onCreateDraft={onCreateDraft}
        onCreateWhiteboard={onCreateWhiteboard}
        onPickWorkspace={onPickWorkspace}
        onRefreshWorkspace={onRefreshWorkspace}
        onboarding={onboarding}
      />
    )
  }

  if (fileLoading) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center text-[14px] text-ds-muted">
        {t('filePreviewLoading')}
      </div>
    )
  }

  if (activeFileIsImage) {
    return (
      <WriteImagePreview
        src={imageDataUrl}
        filePath={activeFilePath}
        mimeType={imageMimeType}
        size={fileSize}
        workspaceRoot={workspaceRoot}
      />
    )
  }

  if (activeFileIsPdf) {
    return (
      <WritePdfViewer
        filePath={activeFilePath}
        dataBase64={pdfDataBase64}
        size={fileSize}
        mtimeMs={pdfMtimeMs}
        workspaceRoot={workspaceRoot}
        viewerRef={editorPaneRef}
        onSelectionChange={onSelectionChange}
      />
    )
  }

  if (activeFileIsOffice && officePreview) {
    if (
      officePreview.sourceFormat === 'xlsx' &&
      onSpreadsheetMutations
    ) {
      return (
        <div ref={editorPaneRef} className="flex h-full min-h-0 min-w-0 flex-col">
          {spreadsheetUnsupportedReason || spreadsheetConflict || spreadsheetSaveError ? (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <span>{spreadsheetUnsupportedReason || officeRefreshError || spreadsheetSaveError}</span>
              {spreadsheetConflict && onResolveSpreadsheetConflict ? (
                <span className="flex shrink-0 items-center gap-2" data-spreadsheet-conflict-count={spreadsheetConflictTargets.length}>
                  <button
                    type="button"
                    onClick={() => onResolveSpreadsheetConflict('keep-local')}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold hover:bg-amber-100 dark:border-amber-700 dark:bg-white/10 dark:hover:bg-white/15"
                  >
                    {t('writeSpreadsheetKeepLocalChanges')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onResolveSpreadsheetConflict('use-external')}
                    className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 font-semibold hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/50 dark:hover:bg-amber-900/70"
                  >
                    {t('writeSpreadsheetUseExternalChanges')}
                  </button>
                </span>
              ) : spreadsheetConflict && onReloadSpreadsheetConflict ? (
                <button type="button" onClick={onReloadSpreadsheetConflict} className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold">
                  {t('writeSpreadsheetReloadExternal')}
                </button>
              ) : spreadsheetSaveError && !spreadsheetUnsupportedReason ? (
                <button
                  type="button"
                  onClick={onSaveShortcut}
                  className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold hover:bg-amber-100 dark:border-amber-700 dark:bg-white/10"
                >
                  {t('writeSpreadsheetRetrySave')}
                </button>
              ) : null}
            </div>
          ) : null}
          <Suspense fallback={(
            <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-ds-muted">
              {t('filePreviewLoading')}
            </div>
          )}>
            <WorkspaceUniverSpreadsheetEditor
              result={officePreview}
              mutations={spreadsheetMutations}
              sourceSha256={spreadsheetSourceSha256 || officePreview.sourceSha256}
              commitRevision={spreadsheetCommitRevision}
              focused={focused}
              onMutationsChange={onSpreadsheetMutations}
              onSelectionChange={handleOfficeSelection}
            />
          </Suspense>
        </div>
      )
    }
    return (
      <div ref={editorPaneRef} className="flex h-full min-h-0 min-w-0 flex-col">
        {officePreview.sourceFormat === 'xls' && onConvertSpreadsheet ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border bg-ds-surface-subtle px-4 py-2 text-[12px] text-ds-muted">
            <span>{t('writeSpreadsheetLegacyReadOnly')}</span>
            <button
              type="button"
              disabled={officeLoading}
              onClick={onConvertSpreadsheet}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 font-semibold text-white hover:brightness-105 disabled:opacity-50"
            >
              {t('writeSpreadsheetConvertToXlsx')}
            </button>
          </div>
        ) : null}
        <WorkspaceOfficePreview
          result={officePreview}
          loading={officeLoading || officeAgentEditing}
          refreshError={officeRefreshError}
          onSelectionChange={handleOfficeSelection}
          onPresentationViewChange={onPresentationViewChange}
          presentationKeyboardActive={focused}
        />
      </div>
    )
  }

  if (activeFileIsOffice) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center px-8 text-center text-[13px] leading-6 text-ds-muted">
        {officeRefreshError ?? t('filePreviewLoading')}
      </div>
    )
  }

  if (activeFileIsCode) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {renderSafety.notice !== 'none' ? (
          <div className="shrink-0 border-b border-amber-200/80 bg-amber-50/90 px-5 py-3 text-[12.5px] leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100 sm:px-6">
            <div className="font-semibold">{fileGuardMessage}</div>
            {fileGuardDetail ? (
              <div className="mt-1 text-amber-800/90 dark:text-amber-100/90">{fileGuardDetail}</div>
            ) : null}
          </div>
        ) : null}
        <WorkspaceCodePreview
          path={activeFilePath}
          content={fileContent}
          className="min-h-0 flex-1"
          limitMessage={renderSafety.notice === 'none'
            ? t('writeLargeFileTruncated')
            : undefined}
        />
      </div>
    )
  }

  if (!activeFileIsText) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center text-[14px] text-ds-muted">
        {t('writeUnsupportedFileType')}
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      <button
        type="button"
        onClick={() => onFocusModeChange(!focusMode)}
        className={`${focusMode ? 'absolute right-2 top-2 z-30 sm:right-0 sm:top-0' : 'absolute right-3 top-3 z-30 opacity-45 hover:opacity-100'} inline-flex h-9 w-9 items-center justify-center rounded-xl border border-ds-border bg-ds-card/95 text-ds-muted shadow-[0_12px_28px_rgba(20,47,95,0.12)] backdrop-blur-xl transition hover:bg-ds-hover hover:text-ds-ink`}
        title={`${t(focusMode ? 'writeFocusModeExit' : 'writeFocusModeEnter')} · ${focusMode ? 'Esc' : t('writeFocusModeShortcut')}`}
        aria-label={t(focusMode ? 'writeFocusModeExit' : 'writeFocusModeEnter')}
        aria-pressed={focusMode}
        aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
      >
        {focusMode
          ? <Minimize2 className="h-4 w-4" strokeWidth={1.85} />
          : <Maximize2 className="h-4 w-4" strokeWidth={1.85} />}
      </button>
      {renderSafety.notice !== 'none' ? (
        <div className="shrink-0 border-b border-amber-200/80 bg-amber-50/90 px-5 py-3 text-[12.5px] leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100 sm:px-6">
          <div className="font-semibold">{fileGuardMessage}</div>
          {fileGuardDetail ? (
            <div className="mt-1 text-amber-800/90 dark:text-amber-100/90">{fileGuardDetail}</div>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        {editorVisible ? (
          <div ref={editorPaneRef} className={`${editorWidth} min-h-0 overflow-hidden`}>
            {richModeActive ? (
              <WriteRichEditor
                value={fileContent}
                workspaceRoot={workspaceRoot}
                filePath={activeFilePath}
                documentEpoch={documentEpoch}
                readOnly={renderSafety.readOnly}
                completionModel={inlineCompletion.model}
                completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
                completionDebounceMs={inlineCompletion.debounceMs}
                completionMinAcceptScore={inlineCompletion.minAcceptScore}
                completionLongEnabled={inlineCompletion.longCompletionEnabled}
                completionLongDebounceMs={inlineCompletion.longDebounceMs}
                completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
                recentEdits={recentEdits}
                onChange={onContentChange}
                onDocumentEdit={onDocumentEdit}
                onSelectionChange={onSelectionChange}
                onSaveShortcut={onSaveShortcut}
                onImagePasteSaved={onImagePasteSaved}
                onImagePasteError={onImagePasteError}
                handleRef={richHandleRef}
                fallback={
                  <WriteMarkdownEditor
                    value={fileContent}
                    workspaceRoot={workspaceRoot}
                    filePath={activeFilePath}
                    documentEpoch={documentEpoch}
                    appearance="live"
                    livePreviewEnabled={renderSafety.livePreviewEnabled}
                    readOnly={renderSafety.readOnly}
                    completionModel={inlineCompletion.model}
                    completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
                    completionDebounceMs={inlineCompletion.debounceMs}
                    completionMinAcceptScore={inlineCompletion.minAcceptScore}
                    completionLongEnabled={inlineCompletion.longCompletionEnabled}
                    completionLongDebounceMs={inlineCompletion.longDebounceMs}
                    completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
                    recentEdits={recentEdits}
                    onChange={onContentChange}
                    onDocumentEdit={onDocumentEdit}
                    onSelectionChange={onSelectionChange}
                    onSaveShortcut={onSaveShortcut}
                    onImagePasteSaved={onImagePasteSaved}
                    onImagePasteError={onImagePasteError}
                    onReviewStateChange={onMarkdownReviewStateChange}
                    handleRef={markdownHandleRef}
                  />
                }
              />
            ) : (
              <WriteMarkdownEditor
                value={fileContent}
                workspaceRoot={workspaceRoot}
                filePath={activeFilePath}
                documentEpoch={documentEpoch}
                appearance={editorAppearance}
                livePreviewEnabled={renderSafety.livePreviewEnabled}
                readOnly={renderSafety.readOnly}
                completionModel={inlineCompletion.model}
                completionEnabled={inlineCompletion.enabled && inlineCompletionApiReady}
                completionDebounceMs={inlineCompletion.debounceMs}
                completionMinAcceptScore={inlineCompletion.minAcceptScore}
                completionLongEnabled={inlineCompletion.longCompletionEnabled}
                completionLongDebounceMs={inlineCompletion.longDebounceMs}
                completionLongMinAcceptScore={inlineCompletion.longMinAcceptScore}
                recentEdits={recentEdits}
                onChange={onContentChange}
                onDocumentEdit={onDocumentEdit}
                onSelectionChange={onSelectionChange}
                onSaveShortcut={onSaveShortcut}
                onImagePasteSaved={onImagePasteSaved}
                onImagePasteError={onImagePasteError}
                onReviewStateChange={onMarkdownReviewStateChange}
                handleRef={markdownHandleRef}
              />
            )}
          </div>
        ) : null}

        {previewVisible ? (
          <div ref={previewPaneRef} className={`${previewWidth} min-h-0 overflow-y-auto overflow-x-hidden`}>
            <WriteMarkdownPreview
              content={debouncedPreviewContent}
              isMarkdown={isMarkdown && renderSafety.markdownPreviewEnabled}
              filePath={activeFilePath}
              workspaceRoot={workspaceRoot}
              previewErrorMessage={t('writePreviewErrorFallback')}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
