import { useCallback, useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { PaperWorkbenchChromeContext, type PaperWorkbenchChrome } from '../../paper/paper-chrome-context'
import { openBoundedPaperReading } from '../../paper/paper-reading-entry'
import { usePaperStore } from '../../write/paper/paper-store'
import { paperUnitDirFromKnownUnits, paperUnitDirForFile } from '../../write/paper/paper-unit'
import { WritePdfRendererProvider } from './write-pdf-renderer-context'
import { PaperPdfReader } from '../paper/reader/PaperPdfReader'
import { PaperImportDialogHost } from '../paper/PaperImportDialogHost'
import { PaperMetadataDrawer } from '../paper/sidebar/PaperMetadataDrawer'
import { PaperTaskRing } from '../paper/PaperTaskRing'
import { PaperReadingDialogHost } from '../paper/evidence/PaperReadingDialog'
import { PaperBatchInterpretDialogHost } from '../paper/batch/PaperBatchInterpretDialog'

export type WorkPaperHostProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  /** Attach a base64 PNG to the assistant composer (vision channel). */
  onAttachImage?: (input: { dataBase64: string; name: string }) => Promise<boolean>
  /** Nothing is open: the assistant fills the center and the editor steps aside. */
  conversationStage: boolean
  /** Assistant panel and rail, right of the editor. */
  rightPanel: ReactNode
  /**
   * The editor, given the submit it must use: inside a paper unit a quick-ask
   * goes through the bounded reading request instead of a generic turn.
   */
  children: (submitPrompt: ((value: string) => void) | undefined) => ReactNode
}

/**
 * Papers are part of every space: the mounted space is indexed as a library
 * (`<space>/papers`), unit PDFs open in the paper reader, and the import,
 * reading and batch dialogs, the metadata drawer and the task ring are always
 * available. The center stays the ordinary editor groups, so the library,
 * discover pages and readers are tabs next to documents and whiteboards.
 */
export function WorkPaperHost({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt,
  onAttachImage,
  conversationStage,
  rightPanel,
  children
}: WorkPaperHostProps): ReactElement {
  const { workspaceRoot, paperReading } = useWriteWorkspaceStore(useShallow((s) => ({
    workspaceRoot: s.workspaceRoot,
    paperReading: s.paperReading
  })))
  const entriesRefreshToken = usePaperModeStore((s) => s.entriesRefreshToken)
  const setEntriesLoading = usePaperModeStore((s) => s.setEntriesLoading)
  const setEntriesResult = usePaperModeStore((s) => s.setEntriesResult)
  const setEntriesError = usePaperModeStore((s) => s.setEntriesError)
  const infoDrawerOpen = usePaperModeStore((s) => s.infoDrawerOpen)
  const setInfoDrawerOpen = usePaperModeStore((s) => s.setInfoDrawerOpen)

  // Reader layout presets and immersive mode collapse the left sidebar
  // through the workbench callback rather than a parallel flag.
  const setLeftSidebarCollapsed = useCallback((collapsed: boolean): void => {
    if (collapsed !== leftSidebarCollapsed) onToggleLeftSidebar()
  }, [leftSidebarCollapsed, onToggleLeftSidebar])
  const chrome = useMemo<PaperWorkbenchChrome>(
    () => ({ leftSidebarCollapsed, setLeftSidebarCollapsed }),
    [leftSidebarCollapsed, setLeftSidebarCollapsed]
  )

  // The reader's NOTES column folds away once its last tab closes, so the
  // remaining view takes the full width instead of an empty group.
  const editorLayout = useWriteWorkspaceStore((s) => s.editorLayout)
  const closeEditorGroup = useWriteWorkspaceStore((s) => s.closeEditorGroup)
  useEffect(() => {
    if (editorLayout.groups.length < 2) return
    const other = editorLayout.groups.find((group) => group.tabs.length > 0)
    const empty = editorLayout.groups.find((group) => group.tabs.length === 0)
    if (empty && other) closeEditorGroup(empty.id)
  }, [editorLayout, closeEditorGroup])

  // Composer sends from a paper unit go through the bounded reading request,
  // which scopes the material and asks before anything reaches a provider.
  const submitPaperPrompt = useCallback((value: string): void => {
    if (!onSubmitPrompt) return
    const workspace = useWriteWorkspaceStore.getState()
    const papers = usePaperModeStore.getState().entries
    const dirs = [...papers.map((entry) => entry.unitDir), ...Object.keys(usePaperStore.getState().unitsByDir)]
    const unit = paperUnitDirFromKnownUnits(workspace.workspaceRoot, workspace.activeFilePath ?? '', dirs)
    const entry = unit ? papers.find((paper) => paper.unitDir === paperUnitDirForFile(unit, workspace.workspaceRoot)) : undefined
    if (unit) void openBoundedPaperReading({ workspaceRoot: workspace.workspaceRoot, unitDir: paperUnitDirForFile(unit, workspace.workspaceRoot), meta: entry?.meta, question: value })
    else onSubmitPrompt(value)
  }, [onSubmitPrompt])

  // Deep paper UI (tree rows, reader cards, the info panel, research) submits
  // through this bridge; re-registered per render so `input` stays fresh.
  useEffect(() => {
    usePaperModeStore.getState().setComposerBridge({
      input,
      setInput,
      ...(onSubmitPrompt ? { submit: submitPaperPrompt } : {}),
      ...(onAttachImage ? { attachImage: onAttachImage } : {})
    })
    return () => {
      const bridge = usePaperModeStore.getState().composerBridge
      if (bridge?.setInput === setInput) usePaperModeStore.getState().setComposerBridge(null)
    }
  }, [input, setInput, onSubmitPrompt, onAttachImage, submitPaperPrompt])

  // Index the space's papers whenever the mounted root changes. Entries arrive
  // unfiltered; query/status/tag filters run client-side for instant chips.
  useEffect(() => {
    if (!workspaceRoot || typeof window.kunGui?.paperLibraryList !== 'function') return
    let canceled = false
    setEntriesLoading(true)
    window.kunGui
      .paperLibraryList({ workspaceRoot, papersDir: paperReading.papersDir })
      .then((result) => {
        if (canceled || useWriteWorkspaceStore.getState().workspaceRoot !== workspaceRoot) return
        if (result.ok) {
          setEntriesResult({ entries: result.entries, counts: result.counts, tags: result.tags, groups: result.groups })
          usePaperStore.getState().rememberUnits(result.entries.map((entry) => ({ unitDir: entry.unitDir, meta: entry.meta })))
        } else {
          setEntriesError(result.message)
        }
      })
      .catch((error) => {
        if (canceled || useWriteWorkspaceStore.getState().workspaceRoot !== workspaceRoot) return
        setEntriesError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      canceled = true
    }
  }, [workspaceRoot, paperReading.papersDir, entriesRefreshToken, setEntriesLoading, setEntriesResult, setEntriesError])

  return (
    <PaperWorkbenchChromeContext.Provider value={chrome}>
      <WritePdfRendererProvider value={PaperPdfReader}>
        <div className={`relative flex min-h-0 flex-1${conversationStage ? ' work-stage-conversation' : ''}`}
          data-work-stage={conversationStage ? 'conversation' : 'documents'}>
          {/* Kept mounted while hidden: the editor owns lifecycle effects. */}
          <div className={conversationStage ? 'hidden' : 'relative flex min-h-0 min-w-0 flex-1 flex-col'}>
            {children(onSubmitPrompt ? submitPaperPrompt : undefined)}
            {workspaceRoot && infoDrawerOpen ? <PaperMetadataDrawer onClose={() => setInfoDrawerOpen(false)} /> : null}
          </div>
          {rightPanel}
          {workspaceRoot ? <PaperTaskRing /> : null}
        </div>
      </WritePdfRendererProvider>
      {workspaceRoot ? <PaperReadingDialogHost /> : null}
      {workspaceRoot ? <PaperBatchInterpretDialogHost /> : null}
      {workspaceRoot ? <PaperImportDialogHost workspaceRoot={workspaceRoot} paperReading={paperReading} /> : null}
    </PaperWorkbenchChromeContext.Provider>
  )
}
