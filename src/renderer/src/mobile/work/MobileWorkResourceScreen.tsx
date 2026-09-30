import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { WorkspaceEntry } from '@shared/workspace-file'
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
import { MobileSheet } from '../sheets/MobileSheet'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'
import { readMobileWorkRoute } from './mobile-work-resource-route'
import { setMobileDocumentsWorkspaceRoot } from './mobile-documents-workspace'
import type { WorkResourceView } from '../navigation/mobile-page'

export function MobileWorkResourceScreen({ resourceKey, view, onBack, onView, onSettings }: {
  resourceKey: string
  view: WorkResourceView
  onBack: () => void
  onView: (view: WorkResourceView) => void
  onSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const translateRef = useRef(t)
  translateRef.current = t
  const composerPickList = useChatStore((state) => state.composerPickList)
  const composerModelGroups = useChatStore((state) => state.composerModelGroups)
  const threads = useChatStore((state) => state.threads)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const selectWriteThread = useChatStore((state) => state.selectWriteThread)
  useWorkbenchWriteAssistantRuntime({ composerPickList, composerModelGroups })
  const work = useWriteWorkspaceStore()
  const mapped = readMobileWorkRoute(resourceKey, work.workspaceRoots)
  const mappedRoot = mapped?.root ?? ''
  const [restoreError, setRestoreError] = useState('')
  const [restoreRetry, setRestoreRetry] = useState(0)
  const [activationRetry, setActivationRetry] = useState(0)
  const initializeWorkspace = work.initializeWorkspace
  useEffect(() => {
    if (!mappedRoot || mappedRoot === work.workspaceRoot) return
    let live = true
    setRestoreError('')
    void initializeWorkspace(mappedRoot).then(() => {
      const current = useWriteWorkspaceStore.getState()
      if (current.workspaceRoot !== mappedRoot || !current.rootDirectory) {
        throw new Error(current.treeError ?? translateRef.current('mobileWorkDocWorkspaceOpenFailed'))
      }
      setMobileDocumentsWorkspaceRoot(mappedRoot, current.workspaceRoots)
    }).catch((cause: unknown) => { if (live) setRestoreError(String(cause)) })
    return () => { live = false }
  }, [mappedRoot, work.workspaceRoot, initializeWorkspace, restoreRetry])
  const entries = Object.values(work.entriesByDir).flat()
  const listedFile = entries.find((entry) => entry.type === 'file'
    && (!mapped || mapped.root === work.workspaceRoot)
    && workFileResourceKey(work.workspaceRoot, entry.path) === resourceKey)
  const mappedPath = mapped?.kind === 'document' && mapped.root === work.workspaceRoot ? mapped.path : null
  const filePath = listedFile?.path ?? mappedPath
  const document = filePath ? work.documentsByPath[filePath] : undefined
  const file: WorkspaceEntry | undefined = listedFile ?? (mappedPath && document ? {
    name: mappedPath.split(/[\\/]/).at(-1) ?? mappedPath, path: mappedPath,
    type: 'file', ext: mappedPath.split('.').at(-1) ?? ''
  } : undefined)
  const board = Object.values(work.whiteboards).find((item) =>
    (!mapped || mapped.root === work.workspaceRoot) && workWhiteboardResourceKey(item.id) === resourceKey)
  const openFile = work.openFile
  const openWhiteboard = work.openWhiteboard
  const activeWhiteboardId = work.activeWhiteboardId
  const activeFilePath = work.activeFilePath
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [menuBusy, setMenuBusy] = useState(false)
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
    if (filePath && (activeFilePath !== filePath || !document)) void openFile(work.workspaceRoot, filePath)
    if (board?.id && activeWhiteboardId !== board.id) openWhiteboard(board.id)
  }, [activeFilePath, activeWhiteboardId, board?.id, document, filePath, openFile, openWhiteboard,
    work.workspaceRoot, activationRetry])
  const expectedAssistantThreadId = board?.threadId ?? (file
    ? activeWriteThreadForWorkspace(work.workspaceRoot, threads, undefined, file.path)?.id ?? null
    : null)
  const resourceReady = board ? activeWhiteboardId === board.id
    : Boolean(file?.path && document && activeFilePath === file.path)
  useEffect(() => {
    if (!resourceReady || !expectedAssistantThreadId || activeThreadId === expectedAssistantThreadId) return
    void selectWriteThread(expectedAssistantThreadId, work.workspaceRoot, file?.path).catch(() => undefined)
  }, [activeThreadId, expectedAssistantThreadId, resourceReady, selectWriteThread, work.workspaceRoot, file?.path])

  if (!file && !board) {
    const waitingForRoot = Boolean(mapped && mapped.root !== work.workspaceRoot && !restoreError)
    const waitingForFile = Boolean(mappedPath && !work.fileError)
    return <section className="kun-mobile-unavailable" role={waitingForRoot || waitingForFile ? 'status' : 'alert'}>
      <p>{restoreError || (waitingForRoot ? t('mobileWorkDocSwitchingWorkspace')
        : waitingForFile ? t('loading') : work.fileError || t('writeFileNotFound'))}</p>
      {mapped && (restoreError || work.fileError) ? <button type="button" onClick={() => {
        if (mapped.root !== work.workspaceRoot) setRestoreRetry((value) => value + 1)
        else setActivationRetry((value) => value + 1)
      }}>{t('mobileWorkDocRetryOpen')}</button> : null}
      <button type="button" onClick={onBack}>{t('back')}</button>
    </section>
  }

  const title = board?.title ?? file?.name ?? resourceKey
  const status = board ? board.phase : document?.saveStatus ?? (work.fileLoading ? 'loading' : 'saved')
  // Single document view (§8.4): read mode renders the same editor
  // read-only instead of a separate preview surface.
  const viewMode = 'rich' as const
  const editable = Boolean(document && (document.kind === 'text' || document.kind === 'code') && !renderSafety.readOnly)
  const assistantSupported = Boolean(board || editable)
  const supportedViews: WorkResourceView[] = board
    ? ['whiteboard', ...(assistantSupported ? ['assistant' as const] : [])]
    : ['read', ...(editable ? ['edit' as const] : []),
        ...(assistantSupported ? ['assistant' as const] : []),
        ...(document?.pendingAgentReview || work.reviewActive ? ['review' as const] : [])]
  const effectiveView = supportedViews.includes(view) ? view : board ? 'whiteboard' : 'read'
  const readOnlyView = effectiveView !== 'edit'

  return <><MobileWorkResource title={title} statusLabel={status} view={effectiveView}
    labels={{ read: t('mobilePreview'), edit: t('mobileEdit'), assistant: t('writeAssistant'),
      review: t('mobileReview'), whiteboard: t('mobileWhiteboard'), back: t('back'), more: t('mobileMore') }}
    supportedViews={supportedViews} onBack={onBack} onMenu={() => { setMenuOpen(true); setMenuError('') }} onView={onView}
    content={effectiveView === 'assistant'
      ? <MobileWorkAssistant expectedThreadId={expectedAssistantThreadId} resourceReady={resourceReady}
          unavailableReason={work.fileError ?? t('mobileWorkDocActivating')} onSettings={onSettings} />
      : <WriteEditorGroupContent
          document={document} whiteboard={board} requestedPath={file?.path ?? null}
          viewMode={viewMode} readOnly={readOnlyView} workspaceRoot={work.workspaceRoot}
          workspaceName={work.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? work.workspaceRoot}
          workspacePathLabel={work.workspaceRoot} workspaceError={work.settingsError ?? work.treeError}
          inlineCompletion={work.inlineCompletion} inlineCompletionApiReady={work.inlineCompletionApiReady}
          recentEdits={document?.recentEdits ?? []} focused focusMode={false}
          markdownHandleRef={markdownHandleRef}
          onFocusModeChange={() => undefined} onFocus={() => undefined}
          onAskAssistant={() => { if (assistantSupported) onView('assistant') }} onCreateDraft={() => undefined}
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
    <MobileSheet open={menuOpen} title={title} closeLabel={t('close')} onClose={() => setMenuOpen(false)}>
      <p>{t('mobileWorkDocHostSaveHint')}</p>
      {file && editable ? <button className="kun-mobile-work-sheet-button" type="button" disabled={menuBusy}
        onClick={() => { setMenuBusy(true); void work.saveDocument(work.workspaceRoot, file.path).then((ok) => {
          if (ok) setMenuOpen(false)
          else setMenuError(useWriteWorkspaceStore.getState().fileError ?? t('mobileWorkDocSaveFailed'))
        }).finally(() => setMenuBusy(false)) }}>{t('mobileWorkDocSaveHost')}</button> : null}
      {file ? <button className="kun-mobile-work-sheet-button" type="button" disabled={menuBusy}
        onClick={() => { setMenuBusy(true); void window.kunGui.saveWorkspaceFileAs({
          workspaceRoot: work.workspaceRoot, sourcePath: file.path, suggestedName: file.name
        }).then((result) => { if (result.ok) setMenuOpen(false); else setMenuError(result.message) })
          .catch((cause: unknown) => setMenuError(String(cause))).finally(() => setMenuBusy(false)) }}>{t('mobileWorkDocDownloadPhone')}</button> : null}
      {file && editable && document?.saveStatus === 'error' ? <>
        <p role="alert">{t('mobileWorkDocConflict')}</p>
        <button className="kun-mobile-work-sheet-button" type="button" disabled={menuBusy}
          onClick={() => { if (!window.confirm(t('mobileWorkDocOverwriteConfirm'))) return
            setMenuBusy(true); void work.saveDocument(work.workspaceRoot, file.path, { resolveExternalConflict: 'keep-local' })
              .then((ok) => { if (ok) setMenuOpen(false); else setMenuError(t('mobileWorkDocOverwriteFailed')) })
              .finally(() => setMenuBusy(false)) }}>{t('mobileWorkDocOverwrite')}</button>
        <button className="kun-mobile-work-sheet-button" type="button" disabled={menuBusy}
          onClick={() => { if (!window.confirm(t('mobileWorkDocDiscardConfirm'))) return
            setMenuBusy(true); void work.syncActiveFileFromDisk(work.workspaceRoot, { path: file.path, force: true })
              .then((ok) => { if (ok) setMenuOpen(false); else setMenuError(t('mobileWorkDocReloadFailed')) })
              .finally(() => setMenuBusy(false)) }}>{t('mobileWorkDocDiscard')}</button>
      </> : null}
      {!assistantSupported && file ? <p>{t('mobileWorkDocAssistantUnsupported')}</p> : null}
      {menuError ? <p role="alert">{menuError}</p> : null}
    </MobileSheet>
  </>
}
