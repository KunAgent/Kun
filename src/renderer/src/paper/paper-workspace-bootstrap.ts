import { create } from 'zustand'
import { usePaperModeStore, emptyPaperLibraryFilter } from './paper-mode-store'
import { usePaperStore } from '../write/paper/paper-store'

/** Local desktop readiness, separate from the persisted library selection. */
export const usePaperWorkspaceBootstrapStore = create<{
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  defaultWorkspaceRoot: string
}>(() => ({ status: 'idle', error: null, defaultWorkspaceRoot: '' }))

/** Never let workspace-relative paper identities survive a root transition. */
export function resetPaperWorkspaceContent(): void {
  usePaperStore.getState().reset()
  usePaperModeStore.setState({
    entries: [],
    counts: { total: 0, unread: 0, reading: 0, read: 0, missingPdf: 0 },
    tags: [],
    groups: [],
    selection: new Set(),
    filter: emptyPaperLibraryFilter(),
    entriesLoading: false,
    entriesError: null,
    importDialogOpen: false,
    infoUnitDir: null,
    infoDrawerOpen: false,
    readerPage: null
  })
  usePaperModeStore.getState().patchDiscover({ researchDraft: null })
}
