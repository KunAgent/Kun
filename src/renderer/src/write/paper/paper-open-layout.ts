import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import { useWriteWorkspaceStore, writeJoinPath } from '../write-workspace-store'
import { normalizePath } from '../write-workspace-store-helpers'
import { PAPER_INTERPRET_SUFFIX, PAPER_NOTES_FILE } from './paper-unit'

/**
 * Open a paper unit as the reading layout (§6.4): PDF in the left (primary)
 * group, NOTES.md in the right (secondary) group at a 0.55 split. Uses the
 * existing two-group editor layout — no separate layout mode.
 */
export async function openPaperUnit(input: {
  workspaceRoot: string
  /** Workspace-relative unit dir (`papers/<slug>`) or absolute path. */
  unitDir: string
  /** Only `pdfFile` is read; v2 meta (with a present pdfFile) also works. */
  meta: Pick<PaperUnitMeta, 'pdfFile'>
}): Promise<void> {
  const store = useWriteWorkspaceStore.getState()
  const root = normalizePath(input.workspaceRoot)
  const unitAbs = input.unitDir.startsWith(root)
    ? normalizePath(input.unitDir)
    : writeJoinPath(root, input.unitDir)
  const notesPath = writeJoinPath(unitAbs, PAPER_NOTES_FILE)

  // Metadata-only units (v2, no pdfFile) open NOTES.md alone.
  if (!input.meta.pdfFile) {
    await store.openFile(root, notesPath, { groupId: 'primary', viewMode: 'rich' })
    return
  }
  const pdfPath = writeJoinPath(unitAbs, input.meta.pdfFile)

  await store.openFile(root, pdfPath, { groupId: 'primary' })
  const layout = useWriteWorkspaceStore.getState().editorLayout
  if (layout.groups.length < 2) {
    store.splitEditorGroup('horizontal')
    useWriteWorkspaceStore.getState().setSplitRatio(0.55)
  } else {
    store.focusEditorGroup('secondary')
  }
  await useWriteWorkspaceStore.getState().openFile(root, notesPath, {
    groupId: 'secondary',
    viewMode: 'rich'
  })
}

/** Re-open a unit's interpretation output in the right group as a new tab. */
export async function openPaperInterpretation(input: {
  workspaceRoot: string
  unitDir: string
  path: string
}): Promise<void> {
  const store = useWriteWorkspaceStore.getState()
  const root = normalizePath(input.workspaceRoot)
  const target = input.path.startsWith(root)
    ? normalizePath(input.path)
    : writeJoinPath(root, input.path)
  if (store.editorLayout.groups.length < 2) {
    store.splitEditorGroup('horizontal')
    useWriteWorkspaceStore.getState().setSplitRatio(0.55)
  } else {
    store.focusEditorGroup('secondary')
  }
  await useWriteWorkspaceStore.getState().openFile(root, target, {
    groupId: 'secondary',
    viewMode: 'rich'
  })
}

/** List the `-解读*.md` files that exist in a unit dir's loaded entries. */
export function interpretationFileNames(entries: ReadonlyArray<{ name: string; type: string }>): string[] {
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.includes(PAPER_INTERPRET_SUFFIX) && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}
