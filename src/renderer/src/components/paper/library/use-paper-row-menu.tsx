import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { confirmDialog } from '../../../lib/confirm-dialog'
import { openLibraryEntry } from '../../../paper/paper-library-actions'
import { trashPaperUnits } from '../../../paper/paper-unit-ops'
import {
  copyPaperEntryBibtex,
  downloadMissingPaperPdfs,
  revealPaperEntry,
  updatePaperEntryMeta
} from '../../../paper/paper-library-row-actions'
import { usePaperStore } from '../../../write/paper/paper-store'
import { PaperRowMenu, type PaperRowMenuAction } from './PaperRowMenu'
import { PaperMetaEditDialog } from './PaperMetaEditDialog'
import { PaperMoveGroupDialog } from './PaperMoveGroupDialog'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

/**
 * Shared context-menu host for paper rows (library table + sidebar trees):
 * owns the floating menu, the meta-edit dialog, and the move-to-group dialog,
 * and dispatches row actions identically in both surfaces. `libraryRoot` is
 * the root of the tree the row lives in — rows from non-active libraries act
 * on their own root.
 */
export function usePaperRowMenu(): {
  host: ReactElement | null
  openMenu: (entry: PaperLibraryEntry, x: number, y: number, libraryRoot?: string, groups?: string[]) => void
} {
  const { t } = useTranslation('common')
  const [menu, setMenu] = useState<{
    entry: PaperLibraryEntry
    x: number
    y: number
    libraryRoot?: string
    groups: string[]
  } | null>(null)
  const [editEntry, setEditEntry] = useState<{ entry: PaperLibraryEntry; libraryRoot?: string } | null>(null)
  const [moveUnits, setMoveUnits] = useState<{
    unitDirs: string[]
    libraryRoot?: string
    groups: string[]
  } | null>(null)

  const runRowAction = async (
    entry: PaperLibraryEntry,
    action: PaperRowMenuAction,
    libraryRoot?: string,
    groups: string[] = []
  ): Promise<void> => {
    if (typeof action === 'object') {
      await updatePaperEntryMeta(entry, { status: action.status }, t, libraryRoot)
      return
    }
    switch (action) {
      case 'open':
        await openLibraryEntry(entry, libraryRoot, t)
        return
      case 'edit':
        setEditEntry({ entry, libraryRoot })
        return
      case 'download-pdf':
        await downloadMissingPaperPdfs([entry], t, libraryRoot)
        return
      case 'copy-bibtex':
        await copyPaperEntryBibtex(entry, t, libraryRoot)
        return
      case 'reveal':
        await revealPaperEntry(entry, libraryRoot)
        return
      case 'move':
        setMoveUnits({ unitDirs: [entry.unitDir], libraryRoot, groups })
        return
      case 'trash': {
        if (!(await confirmDialog(t('writePaperTrashConfirm', { count: 1 })))) return
        const outcome = await trashPaperUnits([entry.unitDir], libraryRoot)
        if (outcome.failed.length) {
          usePaperStore.getState().setNotice({
            tone: 'error',
            message: t('writePaperOpFailed', { count: 1, message: outcome.failed[0].message })
          })
        }
      }
    }
  }

  const host = (
    <>
      {menu ? (
        <PaperRowMenu
          entry={menu.entry}
          x={menu.x}
          y={menu.y}
          onAction={(action) => void runRowAction(menu.entry, action, menu.libraryRoot, menu.groups)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {editEntry ? (
        <PaperMetaEditDialog
          entry={editEntry.entry}
          libraryRoot={editEntry.libraryRoot}
          onClose={() => setEditEntry(null)}
        />
      ) : null}
      {moveUnits ? (
        <PaperMoveGroupDialog
          unitDirs={moveUnits.unitDirs}
          libraryRoot={moveUnits.libraryRoot}
          groups={moveUnits.groups}
          onClose={() => setMoveUnits(null)}
        />
      ) : null}
    </>
  )

  return {
    host,
    openMenu: (entry, x, y, libraryRoot, groups) => setMenu({ entry, x, y, libraryRoot, groups: groups ?? [] })
  }
}
