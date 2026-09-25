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
 * Shared context-menu host for paper rows (library table + sidebar tree):
 * owns the floating menu, the meta-edit dialog, and the move-to-group dialog,
 * and dispatches row actions identically in both surfaces.
 */
export function usePaperRowMenu(): {
  host: ReactElement | null
  openMenu: (entry: PaperLibraryEntry, x: number, y: number) => void
} {
  const { t } = useTranslation('common')
  const [menu, setMenu] = useState<{ entry: PaperLibraryEntry; x: number; y: number } | null>(null)
  const [editEntry, setEditEntry] = useState<PaperLibraryEntry | null>(null)
  const [moveUnits, setMoveUnits] = useState<string[] | null>(null)

  const runRowAction = async (entry: PaperLibraryEntry, action: PaperRowMenuAction): Promise<void> => {
    if (typeof action === 'object') {
      await updatePaperEntryMeta(entry, { status: action.status }, t)
      return
    }
    switch (action) {
      case 'open':
        await openLibraryEntry(entry)
        return
      case 'edit':
        setEditEntry(entry)
        return
      case 'download-pdf':
        await downloadMissingPaperPdfs([entry], t)
        return
      case 'copy-bibtex':
        await copyPaperEntryBibtex(entry, t)
        return
      case 'reveal':
        await revealPaperEntry(entry)
        return
      case 'move':
        setMoveUnits([entry.unitDir])
        return
      case 'trash': {
        if (!(await confirmDialog(t('writePaperTrashConfirm', { count: 1 })))) return
        const outcome = await trashPaperUnits([entry.unitDir])
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
          onAction={(action) => void runRowAction(menu.entry, action)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {editEntry ? <PaperMetaEditDialog entry={editEntry} onClose={() => setEditEntry(null)} /> : null}
      {moveUnits ? <PaperMoveGroupDialog unitDirs={moveUnits} onClose={() => setMoveUnits(null)} /> : null}
    </>
  )

  return {
    host,
    openMenu: (entry, x, y) => setMenu({ entry, x, y })
  }
}
