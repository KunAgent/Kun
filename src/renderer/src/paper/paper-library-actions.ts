import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperTranslate } from '../write/paper/paper-actions'
import { usePaperStore } from '../write/paper/paper-store'
import { newPaperRequestId } from '../write/paper/paper-store'
import { openPaperUnit } from '../write/paper/paper-open-layout'
import { PAPER_NOTES_FILE_NAME } from '@shared/paper/paper-types'
import {
  useWriteWorkspaceStore,
  writeJoinPath
} from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperModeStore } from './paper-mode-store'
import { enterPaperMode } from './paper-mode-actions'
import { applyPaperReaderLayout, readPaperReaderLayout } from './paper-reader-layout'

function paperNotice(notice: { tone: 'info' | 'success' | 'error'; message: string }): void {
  usePaperStore.getState().setNotice(notice)
}

/**
 * Docs-surface file-tree action (§3.2 「加入论文库」): copy a workspace PDF into
 * the active paper library as a unit. When no library is configured, entering
 * paper mode lands on the library onboarding which offers folder picking.
 * Unlike `openPdfAsPaper` this never disturbs the docs editor layout — it is a
 * background import reported through the paper notice strip.
 */
export async function addPdfToPaperLibrary(input: {
  pdfPath: string
  t: PaperTranslate
}): Promise<void> {
  const { t } = input
  const state = useWriteWorkspaceStore.getState()
  const library =
    normalizePath(state.paperMode.activeLibrary)
    || normalizePath(state.paperMode.libraries[0] ?? '')
  if (!library) {
    paperNotice({ tone: 'info', message: t('writePaperModeNeedLibrary') })
    void enterPaperMode()
    return
  }
  const papersDir = state.paperReading.papersDir || 'papers'
  const requestId = newPaperRequestId()
  usePaperStore.getState().beginJob('import', requestId)
  try {
    const result = await window.kunGui.paperImport({
      workspaceRoot: library,
      input: '',
      localPdfPath: input.pdfPath,
      parentDir: papersDir,
      requestId
    })
    if (!result.ok) {
      paperNotice({
        tone: 'error',
        message: t('writePaperErrorGeneric', { message: result.message })
      })
      return
    }
    usePaperStore.getState().rememberUnit(result.unitDir, result.meta)
    paperNotice({
      tone: 'success',
      message: t('writePaperAddedToLibrary', { title: result.meta.title })
    })
  } catch (error) {
    paperNotice({
      tone: 'error',
      message: t('writePaperErrorGeneric', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  } finally {
    usePaperStore.getState().endJob(requestId)
  }
}

/**
 * Open a library entry in the reader view (§3.4): units with a PDF get the
 * PDF+NOTES split; metadata-only units open NOTES.md alone. Records
 * `lastOpenedAt` in the local library state and, when `autoMarkReading` is
 * enabled, flips unread units to `reading`.
 */
export async function openLibraryEntry(entry: PaperLibraryEntry): Promise<void> {
  const store = useWriteWorkspaceStore.getState()
  const root = normalizePath(store.workspaceRoot)
  if (!root) return
  usePaperModeStore.getState().setInfoUnitDir(entry.unitDir)
  if (entry.hasPdf && entry.meta.pdfFile) {
    // openPaperUnit only reads `pdfFile`; pass it explicitly so the v2 meta's
    // optional field narrows to a present value.
    await openPaperUnit({
      workspaceRoot: root,
      unitDir: entry.unitDir,
      meta: { pdfFile: entry.meta.pdfFile }
    })
  } else {
    await store.openFile(
      root,
      writeJoinPath(writeJoinPath(root, entry.unitDir), PAPER_NOTES_FILE_NAME),
      { groupId: 'primary', viewMode: 'rich' }
    )
  }
  // R1.1: the reader layout preset persists across papers — apply the stored
  // choice (阅读/笔记/助手) right after the unit opens.
  if (entry.hasPdf && entry.meta.pdfFile) {
    await applyPaperReaderLayout(readPaperReaderLayout(), {
      workspaceRoot: root,
      unitDir: entry.unitDir,
      pdfFile: entry.meta.pdfFile
    })
  }
  const now = new Date().toISOString()
  void window.kunGui?.paperLocalStateWrite?.({
    libraryRoot: root,
    unitRelDir: entry.unitDir,
    patch: { lastOpenedAt: now }
  })
  if (store.paperMode.autoMarkReading && (entry.meta.status ?? 'unread') === 'unread') {
    void window.kunGui?.paperUpdateMeta?.({
      workspaceRoot: root,
      unitDir: entry.unitDir,
      patch: { status: 'reading' }
    }).then((result) => {
      if (result?.ok) {
        const state = usePaperModeStore.getState()
        state.setEntriesResult({
          entries: state.entries.map((item) =>
            item.unitDir === entry.unitDir ? { ...item, meta: result.meta } : item
          ),
          counts: {
            ...state.counts,
            unread: Math.max(0, state.counts.unread - 1),
            reading: state.counts.reading + 1
          },
          tags: state.tags,
          groups: state.groups
        })
      }
    })
  }
}
