import { usePaperMarksStore } from './paper-marks-store'
import { usePaperModeStore } from './paper-mode-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

/**
 * Reader-facing actions (plan §6.5): last-page/last-opened local state writes
 * and the unread→reading auto-transition on first open.
 */

function libraryRoot(): string {
  return useWriteWorkspaceStore.getState().workspaceRoot
}

export async function paperReaderRecordOpened(unitRelDir: string): Promise<void> {
  const root = libraryRoot()
  if (!root || typeof window.kunGui?.paperLocalStateWrite !== 'function') return
  await window.kunGui.paperLocalStateWrite({
    libraryRoot: root,
    unitRelDir,
    patch: { lastOpenedAt: new Date().toISOString() }
  }).catch(() => undefined)
}

export async function paperReaderRecordPage(unitRelDir: string, page: number, pageCount: number): Promise<void> {
  const root = libraryRoot()
  if (!root || typeof window.kunGui?.paperLocalStateWrite !== 'function') return
  await window.kunGui.paperLocalStateWrite({
    libraryRoot: root,
    unitRelDir,
    patch: { lastPage: page, pageCount }
  }).catch(() => undefined)
}

/** First open of an unread paper marks it `reading` (setting-gated). */
export async function paperReaderAutoMarkReading(entry: PaperLibraryEntry): Promise<void> {
  const state = useWriteWorkspaceStore.getState()
  if (!state.paperMode.autoMarkReading) return
  if ((entry.meta.status ?? 'unread') !== 'unread') return
  if (typeof window.kunGui?.paperUpdateMeta !== 'function') return
  const result = await window.kunGui.paperUpdateMeta({
    workspaceRoot: state.workspaceRoot,
    unitDir: entry.unitDir,
    patch: { status: 'reading' }
  }).catch(() => null)
  if (result?.ok) {
    // Refresh the row in place instead of a full rescan.
    usePaperModeStore.setState((s) => ({
      entries: s.entries.map((e) =>
        e.unitDir === entry.unitDir ? { ...e, meta: result.meta } : e
      )
    }))
  }
}

/** Reset marks state when the reader unit changes (used by PaperPdfReader). */
export function resetPaperMarksFor(unitDir: string): void {
  const store = usePaperMarksStore.getState()
  if (store.unitDir !== unitDir) {
    usePaperMarksStore.setState({ unitDir, items: [], cards: {}, dirty: false })
  }
}
