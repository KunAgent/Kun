import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import { activeWriteThreadForWorkspace } from '../../write/write-thread-registry'
import { useWorkbenchWriteAssistantRuntime } from '../../components/workbench/useWorkbenchWriteAssistantRuntime'
import { WriteEditorGroupContent } from '../../components/write/WriteEditorGroupContent'
import { useWriteEditorGroupFileWatches } from '../../components/write/use-write-editor-group-file-watches'
import { useWriteWorkspaceLifecycle } from '../../components/write/use-write-workspace-lifecycle'
import type { WriteMarkdownEditorHandle } from '../../components/write/WriteMarkdownEditor'
import { getWriteRenderSafety } from '../../write/write-render-safety'
import { MobileWorkResource } from './MobileWorkResource'
import { MobileWorkAssistant } from './MobileWorkAssistant'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'
import type { WorkResourceView } from '../navigation/mobile-page'

export function MobileWorkResourceScreen({ resourceKey, view, onBack, onView, onSettings }: {
  resourceKey: string
  view: WorkResourceView
  onBack: () => void
  onView: (view: WorkResourceView) => void
  onSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const composerPickList = useChatStore((state) => state.composerPickList)
  const composerModelGroups = useChatStore((state) => state.composerModelGroups)
  const threads = useChatStore((state) => state.threads)
  useWorkbenchWriteAssistantRuntime({ composerPickList, composerModelGroups })
  const work = useWriteWorkspaceStore()
  const entries = Object.values(work.entriesByDir).flat()
  const file = entries.find((entry) => entry.type === 'file'
    && workFileResourceKey(work.workspaceRoot, entry.path) === resourceKey)
  const board = Object.values(work.whiteboards).find((item) =>
    workWhiteboardResourceKey(item.id) === resourceKey)
  const document = file ? work.documentsByPath[file.path] : undefined
  const openFile = work.openFile
  const openWhiteboard = work.openWhiteboard
  const activeWhiteboardId = work.activeWhiteboardId
  const saveTimerRef = useRef<number | null>(null)
  const markdownHandleRef = useRef<WriteMarkdownEditorHandle | null>(null)
  const textDocument = document?.kind === 'text' ? document : null
  const renderSafety = getWriteRenderSafety({
    isMarkdown: Boolean(file?.path.match(/\.md(?:own)?$/i)),
    contentLength: textDocument?.fileContent.length ?? 0,
    fileSize: document?.fileSize ?? 0,
    truncated: document?.fileTruncated === true
  })
  useWriteEditorGroupFileWatches({ workspaceRoot: work.workspaceRoot, editorLayout: work.editorLayout })
  useWriteWorkspaceLifecycle({
    workspaceRoot: work.workspaceRoot,
    activeFilePath: file?.path ?? null,
    activeFileIsText: document?.kind === 'text',
    activeFileIsImage: document?.kind === 'image',
    autoSaveEnabled: work.autoSaveEnabled,
    autoSaveDelayMs: work.autoSaveDelayMs,
    fileContent: textDocument?.fileContent ?? '',
    saveStatus: textDocument?.saveStatus ?? 'saved',
    workspaceReady: Boolean(work.workspaceRoot),
    readOnly: renderSafety.readOnly,
    reviewActive: work.reviewActive,
    pendingAgentReview: textDocument?.pendingAgentReview ?? null,
    reviewSurfaceKey: view,
    saveTimerRef,
    documentHandleRef: markdownHandleRef,
    flushSave: work.flushSave,
    syncActiveFileFromDisk: work.syncActiveFileFromDisk,
    syncActiveImageFromDisk: work.syncActiveImageFromDisk,
    setFileContent: work.setFileContent,
    setFileError: work.setFileError,
    clearPendingAgentReview: work.clearPendingAgentReview,
    setReviewActive: work.setReviewActive
  })

  useEffect(() => {
    if (file?.path && !document) void openFile(work.workspaceRoot, file.path)
    if (board?.id && activeWhiteboardId !== board.id) openWhiteboard(board.id)
  }, [activeWhiteboardId, board?.id, document, file?.path, openFile, openWhiteboard, work.workspaceRoot])

  if (!file && !board) {
    return <section className="kun-mobile-unavailable" role="alert">
      <p>{t('writeFileNotFound')}</p><button type="button" onClick={onBack}>{t('back')}</button>
    </section>
  }

  const expectedAssistantThreadId = board?.threadId ?? (file
    ? activeWriteThreadForWorkspace(work.workspaceRoot, threads, undefined, file.path)?.id ?? null
    : null)
  const title = board?.title ?? file?.name ?? resourceKey
  const status = board ? board.phase : document?.saveStatus ?? (work.fileLoading ? 'loading' : 'saved')
  // Single document view (§8.4): read mode renders the same editor
  // read-only instead of a separate preview surface.
  const viewMode = 'rich' as const
  const assistantSupported = Boolean(board || document?.kind === 'text' || document?.kind === 'code')
  const supportedViews: WorkResourceView[] = board
    ? ['whiteboard', ...(assistantSupported ? ['assistant' as const] : [])]
    : ['read', 'edit', ...(assistantSupported ? ['assistant' as const] : []),
        ...(document?.pendingAgentReview || work.reviewActive ? ['review' as const] : [])]
  const effectiveView = supportedViews.includes(view) ? view : board ? 'whiteboard' : 'read'
  const readOnlyView = effectiveView !== 'edit'

  return <MobileWorkResource title={title} statusLabel={status} view={effectiveView}
    labels={{ read: t('mobilePreview'), edit: t('mobileEdit'), assistant: t('writeAssistant'),
      review: t('mobileReview'), whiteboard: t('mobileWhiteboard'), back: t('back'), more: t('mobileMore') }}
    supportedViews={supportedViews} onBack={onBack} onMenu={null} onView={onView}
    content={effectiveView === 'assistant'
      ? <MobileWorkAssistant expectedThreadId={expectedAssistantThreadId} onSettings={onSettings} />
      : <WriteEditorGroupContent
          document={document} whiteboard={board} requestedPath={file?.path ?? null}
          viewMode={viewMode} readOnly={readOnlyView} workspaceRoot={work.workspaceRoot}
          workspaceName={work.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? work.workspaceRoot}
          workspacePathLabel={work.workspaceRoot} workspaceError={work.settingsError ?? work.treeError}
          inlineCompletion={work.inlineCompletion} inlineCompletionApiReady={work.inlineCompletionApiReady}
          recentEdits={document?.recentEdits ?? []} focused focusMode={false}
          markdownHandleRef={markdownHandleRef}
          onFocusModeChange={() => undefined} onFocus={() => undefined}
          onAskAssistant={() => onView('assistant')} onCreateDraft={() => undefined}
          onPickWorkspace={() => onBack()} onRefreshWorkspace={() => void work.refreshWorkspace(work.workspaceRoot)}
          onContentChange={(content) => { if (file) work.setDocumentContent(file.path, content) }}
          onDocumentEdit={work.recordRecentEdits} onSelectionChange={work.setSelection}
          onSaveShortcut={() => { if (file) void work.saveDocument(work.workspaceRoot, file.path) }}
          onImagePasteSaved={() => undefined} onImagePasteError={work.setFileError}
          onPresentationViewChange={(next) => {
            if (next) work.setPresentationViewForGroup('primary', next)
          }}
          onReviewStateChange={work.setReviewActive}
          onSpreadsheetMutations={work.setSpreadsheetMutations}
          onConvertSpreadsheet={(path) => { void work.convertSpreadsheet(work.workspaceRoot, path) }}
          onReloadSpreadsheetConflict={work.reloadSpreadsheetConflict}
          onResolveSpreadsheetConflict={work.resolveSpreadsheetConflict}
        />}
  />
}
