import { usePaperModeStore } from './paper-mode-store'
import { patchPaperSpaceItem, usePaperSpaceStore } from './paper-space-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

/** Legacy Work readers may omit the source; the global reader always supplies it. */
function libraryRoot(): string {
  return useWriteWorkspaceStore.getState().workspaceRoot
}

export async function paperReaderRecordOpened(unitRelDir: string, root = libraryRoot()): Promise<void> {
  if (!root || typeof window.kunGui?.paperLocalStateWrite !== 'function') return
  const patch = { lastOpenedAt: new Date().toISOString() }
  await window.kunGui.paperLocalStateWrite({ libraryRoot: root, unitRelDir, patch }).catch(() => undefined)
  patchPaperSpaceItem(root, unitRelDir, patch)
}

export async function paperReaderRecordPage(unitRelDir: string, page: number, pageCount: number, root = libraryRoot()): Promise<void> {
  if (!root || typeof window.kunGui?.paperLocalStateWrite !== 'function') return
  const patch = { lastPage: page, pageCount }
  await window.kunGui.paperLocalStateWrite({ libraryRoot: root, unitRelDir, patch }).catch(() => undefined)
  patchPaperSpaceItem(root, unitRelDir, patch)
}

/** First open of an unread paper marks it `reading` (setting-gated). */
export async function paperReaderAutoMarkReading(entry: PaperLibraryEntry, root = libraryRoot()): Promise<void> {
  const state = useWriteWorkspaceStore.getState()
  const autoMarkReading = usePaperSpaceStore.getState().autoMarkReading ?? state.paperMode.autoMarkReading
  if (!root || !autoMarkReading) return
  if ((entry.meta.status ?? 'unread') !== 'unread') return
  if (typeof window.kunGui?.paperUpdateMeta !== 'function') return
  const result = await window.kunGui.paperUpdateMeta({
    workspaceRoot: root, unitDir: entry.unitDir, patch: { status: 'reading' }
  }).catch(() => null)
  if (!result?.ok) return
  patchPaperSpaceItem(root, entry.unitDir, { meta: result.meta })
  if (normalizeWorkspaceRoot(useWriteWorkspaceStore.getState().workspaceRoot) !== normalizeWorkspaceRoot(root)) return
  usePaperModeStore.setState((s) => ({
    entries: s.entries.map((e) => e.unitDir === entry.unitDir ? { ...e, meta: result.meta } : e)
  }))
}
