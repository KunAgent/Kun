import type { PaperLibraryEntry, PaperLibraryMetaPatch } from '@shared/paper/paper-library-types'
import type { PaperUnitMetaV2 } from '@shared/paper/paper-meta-v2'
import { useWriteWorkspaceStore, writeJoinPath } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperStore } from '../write/paper/paper-store'
import { revealWorkspacePathInFileManager } from '../lib/open-workspace-path'
import { usePaperModeStore } from './paper-mode-store'

type Translate = (key: string, opts?: Record<string, unknown>) => string

function libraryRoot(): string {
  return normalizePath(useWriteWorkspaceStore.getState().workspaceRoot)
}

function notice(tone: 'success' | 'error' | 'info', message: string): void {
  usePaperStore.getState().setNotice({ tone, message })
}

/** Replace one row's meta in place so the table updates without a rescan. */
function applyRowMeta(unitDir: string, meta: PaperUnitMetaV2): void {
  const state = usePaperModeStore.getState()
  state.setEntriesResult({
    entries: state.entries.map((entry) => entry.unitDir === unitDir ? { ...entry, meta } : entry),
    counts: state.counts,
    tags: state.tags,
    groups: state.groups
  })
  // Counts and the tag list derive from every row; rescan in the background.
  state.refreshEntries()
}

export async function updatePaperEntryMeta(
  entry: PaperLibraryEntry,
  patch: PaperLibraryMetaPatch,
  t: Translate
): Promise<boolean> {
  const root = libraryRoot()
  if (!root || typeof window.kunGui?.paperUpdateMeta !== 'function') return false
  const result = await window.kunGui.paperUpdateMeta({ workspaceRoot: root, unitDir: entry.unitDir, patch })
    .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
  if (!result.ok) {
    notice('error', t('writePaperErrorGeneric', { message: result.message }))
    return false
  }
  applyRowMeta(entry.unitDir, result.meta)
  return true
}

export async function copyPaperEntryBibtex(entry: PaperLibraryEntry, t: Translate): Promise<void> {
  const root = libraryRoot()
  if (!root || typeof window.kunGui?.paperExportBibtex !== 'function') return
  const result = await window.kunGui.paperExportBibtex({ workspaceRoot: root, unitDir: entry.unitDir })
  if (!result.ok) {
    notice('error', t('writePaperErrorGeneric', { message: result.message }))
    return
  }
  try {
    await navigator.clipboard.writeText(result.bibtex)
    notice('success', t('writePaperBibtexCopied'))
  } catch (error) {
    notice('error', t('writePaperErrorGeneric', { message: String(error) }))
  }
}

export async function revealPaperEntry(entry: PaperLibraryEntry): Promise<void> {
  const root = libraryRoot()
  if (!root) return
  const result = await revealWorkspacePathInFileManager(writeJoinPath(root, entry.unitDir), root)
  if (!result.ok) notice('error', result.message)
}

/**
 * Fetch missing main PDFs one by one (arXiv id or recorded pdfUrl). Sequential
 * on purpose: arXiv asks clients not to parallelize downloads.
 */
export async function downloadMissingPaperPdfs(
  entries: readonly PaperLibraryEntry[],
  t: Translate
): Promise<void> {
  const root = libraryRoot()
  if (!root || typeof window.kunGui?.paperDownloadPdf !== 'function') return
  const targets = entries.filter((entry) => !entry.hasPdf)
  if (targets.length === 0) return
  notice('info', t('writePaperDownloadingPdfs', { count: targets.length }))
  let done = 0
  const failures: string[] = []
  for (const entry of targets) {
    const result = await window.kunGui.paperDownloadPdf({ workspaceRoot: root, unitDir: entry.unitDir })
      .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
    if (result.ok) done += 1
    else failures.push(`${entry.meta.title}: ${result.message}`)
  }
  usePaperModeStore.getState().refreshEntries()
  notice(
    failures.length ? 'error' : 'success',
    failures.length
      ? t('writePaperDownloadPdfsPartial', { done, failed: failures.length, message: failures[0] })
      : t('writePaperDownloadPdfsDone', { count: done })
  )
}
