import { useWriteWorkspaceStore, writeJoinPath } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { isWriteFileTab } from '../write/write-editor-layout'
import { PAPER_NOTES_FILE } from '../write/paper/paper-unit'
import { openPaperUnit } from '../write/paper/paper-open-layout'
import type { PaperWorkbenchChrome } from './paper-chrome-context'

/**
 * Reader layout presets (R1.1): the floating-controls layout menu switches
 * between PDF-only reading, PDF+NOTES notes mode, and PDF+assistant mode by
 * driving the existing editor-group/assistant/sidebar actions — no parallel
 * layout mode. The last choice persists in localStorage so the next paper
 * opens with it.
 */

export type PaperReaderLayoutPreset = 'read' | 'notes' | 'assistant'

export const PAPER_READER_LAYOUT_PRESETS: readonly PaperReaderLayoutPreset[] = [
  'read',
  'notes',
  'assistant'
]

const STORAGE_KEY = 'kun.paper.readerLayout'
const NOTES_SPLIT_RATIO = 0.55

export function readPaperReaderLayout(): PaperReaderLayoutPreset {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'read' || stored === 'notes' || stored === 'assistant') return stored
  } catch {
    // localStorage may be unavailable (SSR/tests) — fall back to default.
  }
  return 'notes'
}

export function storePaperReaderLayout(preset: PaperReaderLayoutPreset): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preset)
  } catch {
    // Non-fatal: the preset still applies for this session.
  }
}

export type PaperReaderLayoutUnit = {
  workspaceRoot: string
  unitDir: string
  /** Present when the unit has a PDF; metadata-only units only have NOTES. */
  pdfFile?: string | null
}

/** Close this unit's NOTES.md tab in the secondary group, if open. */
async function closeUnitNotesTab(root: string, unitDir: string): Promise<void> {
  const store = useWriteWorkspaceStore.getState()
  const notesPath = writeJoinPath(writeJoinPath(root, unitDir), PAPER_NOTES_FILE)
  const secondary = store.editorLayout.groups.find((group) => group.id === 'secondary')
  if (!secondary) return
  const hit = secondary.tabs.find(
    (tab) => isWriteFileTab(tab) && normalizePath(tab.path) === notesPath
  )
  if (hit && isWriteFileTab(hit)) {
    await store.closeTab('secondary', hit.path)
  }
}

/** Close the secondary group once it holds no tabs. */
function closeEmptySecondaryGroup(): void {
  const store = useWriteWorkspaceStore.getState()
  const secondary = store.editorLayout.groups.find((group) => group.id === 'secondary')
  if (secondary && secondary.tabs.length === 0) {
    store.closeEditorGroup('secondary')
  }
}

export async function applyPaperReaderLayout(
  preset: PaperReaderLayoutPreset,
  unit: PaperReaderLayoutUnit,
  chrome?: Pick<PaperWorkbenchChrome, 'setLeftSidebarCollapsed'> | null
): Promise<void> {
  const store = useWriteWorkspaceStore.getState()
  const root = normalizePath(unit.workspaceRoot)
  if (!root) return
  // Flush unsaved edits before the layout churns tabs/groups.
  await store.saveAllDocuments(root)

  if (preset === 'read') {
    await closeUnitNotesTab(root, unit.unitDir)
    closeEmptySecondaryGroup()
    store.setAssistantOpen(false)
    chrome?.setLeftSidebarCollapsed(true)
    return
  }
  if (preset === 'assistant') {
    await closeUnitNotesTab(root, unit.unitDir)
    closeEmptySecondaryGroup()
    store.setAssistantOpen(true)
    return
  }
  // 'notes' (default): PDF + NOTES at a 0.55 horizontal split via the shared
  // openPaperUnit path, assistant collapsed.
  if (unit.pdfFile) {
    await openPaperUnit({
      workspaceRoot: root,
      unitDir: unit.unitDir,
      meta: { pdfFile: unit.pdfFile }
    })
    useWriteWorkspaceStore.getState().setSplitRatio(NOTES_SPLIT_RATIO)
  } else {
    await store.openFile(
      root,
      writeJoinPath(writeJoinPath(root, unit.unitDir), PAPER_NOTES_FILE),
      { groupId: 'primary', viewMode: 'rich' }
    )
  }
  useWriteWorkspaceStore.getState().setAssistantOpen(false)
}
