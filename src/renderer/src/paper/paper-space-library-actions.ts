import type { PaperLibraryMetaPatch } from '@shared/paper/paper-library-types'
import { confirmDialog } from '../lib/confirm-dialog'
import { revealWorkspacePathInFileManager } from '../lib/open-workspace-path'
import { usePaperStore } from '../write/paper/paper-store'
import { writeJoinPath } from '../write/write-workspace-store'
import { ensurePaperSpace, refreshPaperSpace } from './paper-space'
import { patchPaperSpaceItem, usePaperSpaceStore, type PaperSpaceItem } from './paper-space-store'
import { trashPaperUnits } from './paper-unit-ops'

type Translate = (key: string, opts?: Record<string, unknown>) => string

export async function updatePaperSpaceItems(
  items: readonly PaperSpaceItem[], patch: PaperLibraryMetaPatch, t: Translate
): Promise<void> {
  const failed: PaperSpaceItem[] = []
  let message = ''
  for (const item of items) {
    const result = await window.kunGui.paperUpdateMeta({
      workspaceRoot: item.libraryRoot, unitDir: item.entry.unitDir, patch
    }).catch((error: unknown) => ({ ok: false as const, message: String(error) }))
    if (result.ok) patchPaperSpaceItem(item.libraryRoot, item.entry.unitDir, { meta: result.meta })
    else { failed.push(item); message ||= result.message }
  }
  usePaperSpaceStore.getState().setSelection(new Set(failed.map((item) => item.key)))
  if (failed.length) usePaperStore.getState().setNotice({
    tone: 'error', message: t('writePaperOpFailed', { count: failed.length, message })
  })
}

export async function trashPaperSpaceItems(items: readonly PaperSpaceItem[], t: Translate): Promise<void> {
  if (!items.length || !(await confirmDialog(t('writePaperTrashConfirm', { count: items.length })))) return
  const failed: string[] = []
  let message = ''
  const roots = [...new Set(items.map((item) => item.libraryRoot))]
  for (const root of roots) {
    const outcome = await trashPaperUnits(items.filter((item) => item.libraryRoot === root).map((item) => item.entry.unitDir), root)
    for (const failure of outcome.failed) {
      const item = items.find((item) => item.libraryRoot === root && item.entry.unitDir === failure.unitDir)
      if (item) failed.push(item.key)
      message ||= failure.message
    }
  }
  usePaperSpaceStore.getState().setSelection(new Set(failed))
  await refreshPaperSpace()
  if (failed.length) usePaperStore.getState().setNotice({
    tone: 'error', message: t('writePaperOpFailed', { count: failed.length, message })
  })
}

/** Export exactly the chosen rows, including legacy sources, without replacing a user's file. */
export async function exportPaperSpaceCitations(items: readonly PaperSpaceItem[], t: Translate): Promise<void> {
  if (!items.length) return
  try {
    const citations: string[] = []
    for (const item of items) {
      const result = await window.kunGui.paperExportBibtex({ workspaceRoot: item.libraryRoot, unitDir: item.entry.unitDir })
      if (!result.ok) throw new Error(result.message)
      citations.push(result.bibtex.trim())
    }
    const workspaceRoot = await ensurePaperSpace()
    const path = `references-${new Date().toISOString().replace(/[:.]/g, '-')}.bib`
    const result = await window.kunGui.writeWorkspaceFile({ workspaceRoot, path, content: `${citations.filter(Boolean).join('\n\n')}\n` })
    if (!result.ok) throw new Error(result.message)
    usePaperStore.getState().setNotice({
      tone: 'success', message: t('writePaperBibtexExported', { path: writeJoinPath(workspaceRoot, path) }),
      action: {
        label: t(window.kunGui.platform === 'darwin' ? 'fileTreeRevealInFinder' : 'fileTreeRevealInFileManager'),
        run: () => { void revealWorkspacePathInFileManager(writeJoinPath(workspaceRoot, path), workspaceRoot) }
      }
    })
  } catch (error) {
    usePaperStore.getState().setNotice({ tone: 'error', message: t('writePaperErrorGeneric', { message: String(error) }) })
  }
}
