import { useEffect, type ReactElement, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { WriteWorkspaceView } from '../write/WriteWorkspaceView'
import { WritePdfRendererProvider } from '../write/write-pdf-renderer-context'
import { PaperPdfReader } from './reader/PaperPdfReader'
import { PaperImportDialogHost } from './PaperImportDialogHost'
import { PaperLibraryOnboarding } from './PaperLibraryOnboarding'
import { PaperLibraryView } from './PaperLibraryView'
import { PaperDiscoverView } from './PaperDiscoverView'

export type PaperWorkspaceViewProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  onOpenAgentSettings?: () => void
  rightPanel: ReactNode
}

/**
 * Papers-surface stage (§3.4): hosts the library table, the discover view, and
 * the reader (the ordinary Write editor groups). The reader stays mounted —
 * hidden via `hidden` — so PDF scroll position and NOTES state survive view
 * switches. Without a configured library the onboarding card replaces all
 * views.
 */
export function PaperWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt,
  onOpenAgentSettings,
  rightPanel
}: PaperWorkspaceViewProps): ReactElement {
  const { t } = useTranslation('common')
  const { workspaceRoot, paperReading, paperMode } = useWriteWorkspaceStore(
    useShallow((s) => ({
      workspaceRoot: s.workspaceRoot,
      paperReading: s.paperReading,
      paperMode: s.paperMode
    }))
  )
  const view = usePaperModeStore((s) => s.view)
  const entriesRefreshToken = usePaperModeStore((s) => s.entriesRefreshToken)
  const setEntriesLoading = usePaperModeStore((s) => s.setEntriesLoading)
  const setEntriesResult = usePaperModeStore((s) => s.setEntriesResult)
  const setEntriesError = usePaperModeStore((s) => s.setEntriesError)

  const hasLibrary = paperMode.libraries.length > 0

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

  const readerVisible = hasLibrary && view === 'reader'

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!hasLibrary ? (
            <PaperLibraryOnboarding />
          ) : (
            <>
              {view === 'library' ? <PaperLibraryView onSubmitPrompt={onSubmitPrompt} /> : null}
              {view === 'discover' ? <PaperDiscoverView /> : null}
            </>
          )}
          <div className={readerVisible ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
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
          </div>
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
