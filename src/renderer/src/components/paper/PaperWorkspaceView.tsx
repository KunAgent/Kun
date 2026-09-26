import { useCallback, useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { isWritePaperViewTab } from '../../write/write-editor-layout'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { PaperWorkbenchChromeContext, type PaperWorkbenchChrome } from '../../paper/paper-chrome-context'
import { WriteWorkspaceView } from '../write/WriteWorkspaceView'
import { WritePdfRendererProvider } from '../write/write-pdf-renderer-context'
import { PaperPdfReader } from './reader/PaperPdfReader'
import { PaperImportDialogHost } from './PaperImportDialogHost'
import { PaperLibraryOnboarding } from './PaperLibraryOnboarding'
import { PaperTaskRing } from './PaperTaskRing'

export type PaperWorkspaceViewProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  /** R2.4: attach a base64 PNG to the assistant composer (vision channel). */
  onAttachImage?: (input: { dataBase64: string; name: string }) => Promise<boolean>
  onOpenAgentSettings?: () => void
  rightPanel: ReactNode
}

/**
 * Papers-surface stage (U4): the center column is always the ordinary editor
 * groups — library/discover live inside it as fixed virtual tabs alongside
 * file tabs (the reader). The pinned 「论文库」 tab is re-created at index 0
 * if a persisted layout lost it. The composer bridge lets deep paper UI
 * (tree rows, reader cards, the info panel) submit to the assistant.
 */
export function PaperWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt,
  onAttachImage,
  onOpenAgentSettings,
  rightPanel
}: PaperWorkspaceViewProps): ReactElement {
  const { workspaceRoot, paperReading, paperMode } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoot: s.workspaceRoot,
      paperReading: s.paperReading,
      paperMode: s.paperMode
    }))
  )
  const openPaperViewTab = useWriteWorkspaceStore((s) => s.openPaperViewTab)
  const entriesRefreshToken = usePaperModeStore((s) => s.entriesRefreshToken)
  const setEntriesLoading = usePaperModeStore((s) => s.setEntriesLoading)
  const setEntriesResult = usePaperModeStore((s) => s.setEntriesResult)
  const setEntriesError = usePaperModeStore((s) => s.setEntriesError)

  const hasLibrary = paperMode.libraries.length > 0

  // Deep paper UI (reader layout presets, immersive mode) collapses the left
  // sidebar through the workbench callback rather than a parallel flag.
  const setLeftSidebarCollapsed = useCallback((collapsed: boolean): void => {
    if (collapsed !== leftSidebarCollapsed) onToggleLeftSidebar()
  }, [leftSidebarCollapsed, onToggleLeftSidebar])
  const chrome = useMemo<PaperWorkbenchChrome>(
    () => ({ leftSidebarCollapsed, setLeftSidebarCollapsed }),
    [leftSidebarCollapsed, setLeftSidebarCollapsed]
  )

  // The library tab is pinned: restore it when the persisted layout lost it
  // (e.g. a layout saved before virtual tabs existed).
  useEffect(() => {
    if (!hasLibrary) return
    const layout = useWriteWorkspaceStore.getState().editorLayout
    const pinned = layout.groups.some((group) =>
      group.tabs.some((tab) => isWritePaperViewTab(tab) && tab.view === 'library')
    )
    if (!pinned) openPaperViewTab('library')
  }, [hasLibrary, openPaperViewTab])

  // Paper mode never shows the docs start page: when the reader closes the
  // last tab of a split group (typically the NOTES column), fold the group
  // back so the remaining view takes the full width.
  const editorLayout = useWriteWorkspaceStore((s) => s.editorLayout)
  const closeEditorGroup = useWriteWorkspaceStore((s) => s.closeEditorGroup)
  useEffect(() => {
    if (editorLayout.groups.length < 2) return
    const empty = editorLayout.groups.find((group) => group.tabs.length === 0)
    if (empty) closeEditorGroup(empty.id)
  }, [editorLayout, closeEditorGroup])

  // Register the composer bridge for sidebar/reader actions (interpret,
  // quick-ask cards, suggested prompts). Re-registered per render so `input`
  // stays fresh.
  useEffect(() => {
    usePaperModeStore.getState().setComposerBridge({
      input,
      setInput,
      ...(onSubmitPrompt ? { submit: onSubmitPrompt } : {}),
      ...(onAttachImage ? { attachImage: onAttachImage } : {})
    })
    return () => {
      const bridge = usePaperModeStore.getState().composerBridge
      if (bridge?.setInput === setInput) {
        usePaperModeStore.getState().setComposerBridge(null)
      }
    }
  }, [input, setInput, onSubmitPrompt, onAttachImage])

  // Index the active library whenever the mounted root changes; the store's
  // workspaceRoot is the library root on this surface. Entries arrive
  // unfiltered — query/status/tag filters run client-side for instant chips.
  useEffect(() => {
    if (!hasLibrary || !workspaceRoot) return
    if (typeof window.kunGui?.paperLibraryList !== 'function') return
    let canceled = false
    setEntriesLoading(true)
    window.kunGui
      .paperLibraryList({ workspaceRoot, papersDir: paperReading.papersDir })
      .then((result) => {
        if (canceled) return
        if (result.ok) {
          setEntriesResult({
            entries: result.entries,
            counts: result.counts,
            tags: result.tags,
            groups: result.groups
          })
        } else {
          setEntriesError(result.message)
        }
      })
      .catch((error) => {
        if (canceled) return
        setEntriesError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      canceled = true
    }
  }, [
    hasLibrary,
    workspaceRoot,
    paperReading.papersDir,
    entriesRefreshToken,
    setEntriesLoading,
    setEntriesResult,
    setEntriesError
  ])

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {!hasLibrary ? (
            <PaperLibraryOnboarding />
          ) : (
            <PaperWorkbenchChromeContext.Provider value={chrome}>
              <WritePdfRendererProvider value={PaperPdfReader}>
                <WriteWorkspaceView
                  leftSidebarCollapsed={leftSidebarCollapsed}
                  onToggleLeftSidebar={onToggleLeftSidebar}
                  input={input}
                  setInput={setInput}
                  onSubmitPrompt={onSubmitPrompt}
                  onOpenAgentSettings={onOpenAgentSettings}
                />
              </WritePdfRendererProvider>
            </PaperWorkbenchChromeContext.Provider>
          )}
          {hasLibrary ? <PaperTaskRing /> : null}
        </div>
        {rightPanel}
      </div>
      <PaperImportDialogHost
        workspaceRoot={workspaceRoot}
        paperReading={paperReading}
      />
    </>
  )
}
