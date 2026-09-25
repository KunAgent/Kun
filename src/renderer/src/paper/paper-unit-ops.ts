import type { WriteEditorGroupId, WritePreviewMode } from '../write/write-workspace-store-types'
import { useWriteWorkspaceStore, writeJoinPath } from '../write/write-workspace-store'
import { isWriteFileTab } from '../write/write-editor-layout'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperModeStore } from './paper-mode-store'

/**
 * Directory-level operations on paper units that must keep the editor in
 * sync: trashing a unit closes its open tabs (otherwise autosave would write
 * NOTES.md back into the trashed path), and moving a unit into a group
 * reopens its tabs at the new location.
 */

type OpenUnitTab = { groupId: WriteEditorGroupId; relPath: string; viewMode: WritePreviewMode }

function unitAbsDir(root: string, unitDir: string): string {
  return normalizePath(writeJoinPath(root, unitDir))
}

/** Open file tabs inside `unitDir`, as paths relative to the unit dir. */
function openTabsInUnit(root: string, unitDir: string): OpenUnitTab[] {
  const prefix = `${unitAbsDir(root, unitDir)}/`
  const out: OpenUnitTab[] = []
  for (const group of useWriteWorkspaceStore.getState().editorLayout.groups) {
    for (const tab of group.tabs) {
      if (!isWriteFileTab(tab)) continue
      const path = normalizePath(tab.path)
      if (path.startsWith(prefix)) {
        out.push({ groupId: group.id, relPath: path.slice(prefix.length), viewMode: tab.viewMode })
      }
    }
  }
  return out
}

async function closeTabsInUnit(root: string, unitDir: string, tabs: OpenUnitTab[]): Promise<void> {
  const base = unitAbsDir(root, unitDir)
  for (const tab of tabs) {
    // force: the unit is about to disappear from this path; edits were saved
    // (move) or are intentionally discarded with the unit (trash).
    await useWriteWorkspaceStore.getState().closeTab(tab.groupId, `${base}/${tab.relPath}`, true)
  }
}

export type PaperUnitOpsOutcome = { done: string[]; failed: { unitDir: string; message: string }[] }

export async function trashPaperUnits(unitDirs: readonly string[]): Promise<PaperUnitOpsOutcome> {
  const root = normalizePath(useWriteWorkspaceStore.getState().workspaceRoot)
  const outcome: PaperUnitOpsOutcome = { done: [], failed: [] }
  if (!root || typeof window.kunGui?.paperTrashUnit !== 'function') return outcome
  for (const unitDir of unitDirs) {
    await closeTabsInUnit(root, unitDir, openTabsInUnit(root, unitDir))
    const result = await window.kunGui.paperTrashUnit({ workspaceRoot: root, unitDir })
      .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
    if (result.ok) outcome.done.push(unitDir)
    else outcome.failed.push({ unitDir, message: result.message })
  }
  if (outcome.done.length) usePaperModeStore.getState().refreshEntries()
  return outcome
}

export async function movePaperUnitsToGroup(
  unitDirs: readonly string[],
  group: string
): Promise<PaperUnitOpsOutcome> {
  const store = useWriteWorkspaceStore.getState()
  const root = normalizePath(store.workspaceRoot)
  const outcome: PaperUnitOpsOutcome = { done: [], failed: [] }
  if (!root || typeof window.kunGui?.paperMoveToGroup !== 'function') return outcome
  if (!(await store.saveAllDocuments(root))) {
    return { done: [], failed: unitDirs.map((unitDir) => ({ unitDir, message: 'save-failed' })) }
  }
  for (const unitDir of unitDirs) {
    const tabs = openTabsInUnit(root, unitDir)
    await closeTabsInUnit(root, unitDir, tabs)
    const result = await window.kunGui.paperMoveToGroup({ workspaceRoot: root, unitDir, group })
      .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
    const nextUnitDir = result.ok ? result.unitDir : unitDir
    if (result.ok) outcome.done.push(unitDir)
    else outcome.failed.push({ unitDir, message: result.message })
    // Reopen at the new location (or the old one when the move failed).
    for (const tab of tabs) {
      await useWriteWorkspaceStore.getState().openFile(
        root,
        `${unitAbsDir(root, nextUnitDir)}/${tab.relPath}`,
        { groupId: tab.groupId, viewMode: tab.viewMode }
      )
    }
  }
  if (outcome.done.length) usePaperModeStore.getState().refreshEntries()
  return outcome
}
