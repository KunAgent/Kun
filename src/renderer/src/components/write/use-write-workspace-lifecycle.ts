import { useEffect, useRef, type MutableRefObject } from 'react'
import { useWriteWorkspaceStore, type WriteWorkspaceState } from '../../write/write-workspace-store'
import { writeDocumentContextMatches } from '../../write/write-document-context'
import type { WriteDocumentReviewHandle } from './write-document-editor-handle'
import i18n from '../../i18n'

type PendingAgentReview = NonNullable<WriteWorkspaceState['pendingAgentReview']>

export function pendingWriteAgentReviewMatches(
  state: Pick<WriteWorkspaceState, 'workspaceRoot' | 'activeFilePath' | 'documentEpoch'>,
  review: PendingAgentReview
): boolean {
  return writeDocumentContextMatches(state, review)
}

export function canApplyPendingWriteAgentReviewDirectly(
  state: Pick<WriteWorkspaceState, 'workspaceRoot' | 'activeFilePath' | 'documentEpoch' | 'saveStatus'>,
  review: PendingAgentReview
): boolean {
  return pendingWriteAgentReviewMatches(state, review) && state.saveStatus === 'saved'
}

type UseWriteWorkspaceLifecycleOptions = {
  workspaceRoot: string
  activeFilePath: string | null
  activeFileIsText: boolean
  activeFileIsImage: boolean
  autoSaveEnabled: boolean
  autoSaveDelayMs: number
  fileContent: string
  saveStatus: WriteWorkspaceState['saveStatus']
  workspaceReady: boolean
  readOnly: boolean
  reviewActive: boolean
  pendingAgentReview: PendingAgentReview | null
  reviewSurfaceKey: string
  saveTimerRef: MutableRefObject<number | null>
  documentHandleRef: MutableRefObject<WriteDocumentReviewHandle | null>
  flushSave: WriteWorkspaceState['flushSave']
  syncActiveFileFromDisk: WriteWorkspaceState['syncActiveFileFromDisk']
  syncActiveImageFromDisk: WriteWorkspaceState['syncActiveImageFromDisk']
  setFileContent: WriteWorkspaceState['setFileContent']
  setFileError: WriteWorkspaceState['setFileError']
  clearPendingAgentReview: WriteWorkspaceState['clearPendingAgentReview']
  setReviewActive: WriteWorkspaceState['setReviewActive']
}

export function useWriteWorkspaceLifecycle({
  workspaceRoot,
  activeFilePath,
  activeFileIsText,
  activeFileIsImage,
  autoSaveEnabled,
  autoSaveDelayMs,
  fileContent,
  saveStatus,
  workspaceReady,
  readOnly,
  reviewActive,
  pendingAgentReview,
  reviewSurfaceKey,
  saveTimerRef,
  documentHandleRef,
  flushSave,
  syncActiveFileFromDisk,
  syncActiveImageFromDisk,
  setFileContent,
  setFileError,
  clearPendingAgentReview,
  setReviewActive
}: UseWriteWorkspaceLifecycleOptions): void {
  const autoSaveEnabledRef = useRef(autoSaveEnabled)
  autoSaveEnabledRef.current = autoSaveEnabled

  useEffect(() => {
    if (!pendingAgentReview) return
    const current = useWriteWorkspaceStore.getState()
    if (!pendingWriteAgentReviewMatches(current, pendingAgentReview)) {
      clearPendingAgentReview()
      if (!documentHandleRef.current?.isDiffReviewActive()) setReviewActive(false)
      return
    }
    const baseline = current.fileContent
    const started = documentHandleRef.current?.beginDiffReview({
      original: baseline,
      nextDoc: pendingAgentReview.nextContent
    }) ?? false
    if (started) {
      clearPendingAgentReview()
      return
    }
    if (!started) {
      const latest = useWriteWorkspaceStore.getState()
      if (!pendingWriteAgentReviewMatches(latest, pendingAgentReview)) {
        clearPendingAgentReview()
        setReviewActive(false)
        return
      }
      if (!canApplyPendingWriteAgentReviewDirectly(latest, pendingAgentReview)) {
        // Rich mode has no line-diff surface. Preserve the dirty/error draft
        // and keep reviewActive set so background autosave stays paused. The
        // pending snapshot also makes normal flushes fail closed; an explicit
        // Save can resolve the conflict in favor of the local draft.
        setFileError(i18n.t('common:writeExternalChangeConflict'))
        setReviewActive(true)
        return
      }
      // No source editor (or an identical clean document): applying is safe
      // only while the originating saved document epoch is still current.
      clearPendingAgentReview()
      setFileContent(pendingAgentReview.nextContent)
      setReviewActive(false)
    }
  }, [
    clearPendingAgentReview,
    documentHandleRef,
    pendingAgentReview,
    reviewSurfaceKey,
    setFileContent,
    setFileError,
    setReviewActive
  ])

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (
      !autoSaveEnabled ||
      saveStatus !== 'dirty' ||
      !workspaceReady ||
      !activeFileIsText ||
      readOnly ||
      reviewActive
    ) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushSave(workspaceRoot)
    }, autoSaveDelayMs)
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [
    activeFileIsText,
    autoSaveDelayMs,
    autoSaveEnabled,
    fileContent,
    flushSave,
    readOnly,
    reviewActive,
    saveStatus,
    saveTimerRef,
    workspaceReady,
    workspaceRoot
  ])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    if (autoSaveEnabledRef.current) void useWriteWorkspaceStore.getState().flushSave(workspaceRoot)
  }, [saveTimerRef, workspaceRoot])

}
