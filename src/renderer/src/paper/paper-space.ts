import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { usePaperModeStore } from './paper-mode-store'
import { paperSpaceItems, patchPaperSpaceItem, usePaperSpaceStore, type PaperSpaceItem, type PaperSpaceView } from './paper-space-store'

let ensuring: Promise<string> | undefined
let refreshGeneration = 0

async function readPaperSpaceRegistration(workspaceRoot: string) {
  const { write } = await rendererRuntimeClient.getSettings({ forceRefresh: true })
  const libraryRoots = [...new Set(write.paperMode.libraries.map(normalizeWorkspaceRoot).filter(Boolean))]
  const sourceRoots = [...new Set([workspaceRoot, ...libraryRoots, ...write.workspaces].map(normalizeWorkspaceRoot).filter(Boolean))]
  return { libraryRoots, sourceRoots, paperReading: write.paperReading, autoMarkReading: write.paperMode.autoMarkReading }
}

/** Reading configuration is app-owned, even before a Work folder has ever been mounted. */
export function paperSpaceReadingSettings() {
  return usePaperSpaceStore.getState().paperReading ?? useWriteWorkspaceStore.getState().paperReading
}

/** Resolve the trusted, persisted paper space. Work navigation never chooses this root. */
export async function ensurePaperSpace(): Promise<string> {
  const current = usePaperSpaceStore.getState()
  if (current.status === 'ready' && current.workspaceRoot) return current.workspaceRoot
  if (ensuring) return ensuring
  usePaperSpaceStore.setState({ status: 'loading', error: null })
  ensuring = Promise.resolve().then(async () => {
    try {
      if (typeof window.kunGui?.paperWorkspaceEnsure !== 'function') {
        throw new Error('The paper workspace is unavailable. Restart Kun and try again.')
      }
      const result = await window.kunGui.paperWorkspaceEnsure()
      if (!result.ok) throw new Error(result.message)
      const workspaceRoot = normalizeWorkspaceRoot(result.workspaceRoot)
      const registration = await readPaperSpaceRegistration(workspaceRoot)
      usePaperSpaceStore.setState({ workspaceRoot, ...registration, status: 'ready', error: null })
      return workspaceRoot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Do not clear the index, pick another root, or recreate a missing library.
      usePaperSpaceStore.setState({ status: 'error', error: message })
      throw error
    } finally {
      ensuring = undefined
    }
  })
  return ensuring
}

/** Only explicitly registered libraries/Work spaces are indexed; files stay in place. */
export async function refreshPaperSpace(): Promise<void> {
  const request = ++refreshGeneration
  usePaperSpaceStore.setState({ loading: true })
  try {
    const workspaceRoot = await ensurePaperSpace()
    const registration = await readPaperSpaceRegistration(workspaceRoot)
    if (request !== refreshGeneration) return
    const { sourceRoots, paperReading } = registration
    const results = await Promise.all(sourceRoots.map(async (root) => {
      try {
        const result = await window.kunGui.paperLibraryList({ workspaceRoot: root, papersDir: paperReading.papersDir })
        return { root, result }
      } catch (error) {
        return { root, result: { ok: false as const, message: error instanceof Error ? error.message : String(error) } }
      }
    }))
    if (request !== refreshGeneration) return
    usePaperSpaceStore.setState((state) => {
      const entriesByRoot = Object.fromEntries(Object.entries(state.entriesByRoot).filter(([root]) => sourceRoots.includes(root)))
      const errorsByRoot: Record<string, string> = {}
      for (const { root, result } of results) {
        if (result.ok) entriesByRoot[root] = result.entries
        else errorsByRoot[root] = result.message
      }
      const items = paperSpaceItems(entriesByRoot)
      const keys = new Set(items.map((item) => item.key))
      return {
        ...registration, status: 'ready', error: null, entriesByRoot, errorsByRoot, items, loading: false, loaded: true,
        selection: new Set([...state.selection].filter((key) => keys.has(key)))
      }
    })
  } catch (error) {
    if (request === refreshGeneration) usePaperSpaceStore.setState({ loading: false, status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

export async function openPaperSpace(view: PaperSpaceView = 'library', importing = false): Promise<boolean> {
  const { preparePaperNotesForNavigation } = await import('./paper-notes-draft')
  if (!(await preparePaperNotesForNavigation())) return false
  usePaperSpaceStore.getState().setView(view)
  const { useChatStore } = await import('../store/chat-store')
  useChatStore.setState({ route: 'papers' })
  if (importing) {
    try {
      await ensurePaperSpace()
      usePaperModeStore.getState().setImportDialogOpen(true)
    } catch {
      // The route presents the bootstrap error and an explicit retry.
    }
  }
  return true
}

export async function openPaperSpaceItem(item: PaperSpaceItem): Promise<void> {
  const { preparePaperNotesForNavigation } = await import('./paper-notes-draft')
  if (!(await preparePaperNotesForNavigation())) return
  usePaperSpaceStore.setState((state) => {
    const entries = state.entriesByRoot[item.libraryRoot] ?? []
    const entriesByRoot = entries.some((entry) => entry.unitDir === item.entry.unitDir) ? state.entriesByRoot
      : { ...state.entriesByRoot, [item.libraryRoot]: [...entries, item.entry] }
    return { readerKey: item.key, entriesByRoot, items: paperSpaceItems(entriesByRoot) }
  })
  const { useChatStore } = await import('../store/chat-store')
  useChatStore.setState({ route: 'papers' })
  const now = new Date().toISOString()
  void window.kunGui.paperLocalStateWrite?.({
    libraryRoot: item.libraryRoot, unitRelDir: item.entry.unitDir, patch: { lastOpenedAt: now }
  }).catch(() => undefined)
  const autoMarkReading = usePaperSpaceStore.getState().autoMarkReading ?? useWriteWorkspaceStore.getState().paperMode.autoMarkReading
  if (autoMarkReading && (item.entry.meta.status ?? 'unread') === 'unread') {
    const result = await window.kunGui.paperUpdateMeta({
      workspaceRoot: item.libraryRoot, unitDir: item.entry.unitDir, patch: { status: 'reading' }
    }).catch(() => null)
    if (result?.ok) patchPaperSpaceItem(item.libraryRoot, item.entry.unitDir, { meta: result.meta })
  }
}
