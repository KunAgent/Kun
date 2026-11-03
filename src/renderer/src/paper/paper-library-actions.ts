import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperTranslate } from '../write/paper/paper-actions'
import { usePaperStore } from '../write/paper/paper-store'
import { newPaperRequestId } from '../write/paper/paper-store'
import {
  useWriteWorkspaceStore
} from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperModeStore } from './paper-mode-store'
import { rememberPaperSpace } from './paper-mode-actions'
import { paperImportParentDir } from './paper-import-target'
import { ensurePaperSpace, openPaperSpaceItem, refreshPaperSpace, paperSpaceReadingSettings } from './paper-space'
import { paperSpaceItemKey, usePaperSpaceStore } from './paper-space-store'

function paperNotice(notice: { tone: 'info' | 'success' | 'error'; message: string }): void {
  usePaperStore.getState().setNotice(notice)
}

/**
 * File-tree action 「加入论文」: copy a PDF of the space into its papers folder
 * as a unit. A background import reported through the notice, which offers
 * to open the new paper; the editor layout is left alone.
 */
export async function addPdfToPaperLibrary(input: {
  pdfPath: string
  t: PaperTranslate
}): Promise<void> {
  const { t } = input
  const state = useWriteWorkspaceStore.getState()
  const library = await ensurePaperSpace().catch((error: unknown) => {
    paperNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) }); return ''
  })
  if (!library) return
  const parentDir = paperImportParentDir(paperSpaceReadingSettings().papersDir, '')
  const requestId = newPaperRequestId()
  usePaperStore.getState().beginJob('import', requestId)
  try {
    const result = await window.kunGui.paperImport({
      workspaceRoot: library,
      input: '',
      localPdfPath: input.pdfPath,
      parentDir,
      requestId
    })
    if (!result.ok) {
      paperNotice({
        tone: 'error',
        message: t('writePaperErrorGeneric', { message: result.message })
      })
      return
    }
    if (normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) !== library) return
    usePaperModeStore.getState().refreshEntries()
    void rememberPaperSpace(library)
    usePaperStore.getState().setNotice({
      tone: 'success',
      message: t(result.reused ? 'workPaperAlreadyInLibrary' : 'writePaperAddedToLibrary', { title: result.meta.title }),
      action: {
        label: t('workPaperOpen'),
        run: () => {
          void refreshPaperSpace().then(() => {
            const source = result.workspaceRoot ?? library
            const item = usePaperSpaceStore.getState().items.find((paper) => paper.libraryRoot === source && paper.entry.unitDir === result.unitDir)
            if (item) void openPaperSpaceItem(item)
          })
        }
      }
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

/** Open every library source in the global reader without mounting it as Work. */
export async function openLibraryEntry(entry: PaperLibraryEntry, libraryRoot?: string, _t?: PaperTranslate): Promise<void> {
  const root = normalizePath(libraryRoot || useWriteWorkspaceStore.getState().workspaceRoot)
  if (!root) return
  await openPaperSpaceItem({ key: paperSpaceItemKey(root, entry.unitDir), libraryRoot: root, entry })
}
