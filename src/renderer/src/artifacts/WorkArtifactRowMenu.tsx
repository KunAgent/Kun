import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, PencilLine, Trash2 } from 'lucide-react'
import type { LibraryArtifact } from './artifact-types'

/**
 * Row actions for a Work whiteboard. Work's whiteboards no longer appear in the
 * file tree, so rename and delete have to stay reachable from the library.
 */
export function WorkArtifactRowMenu({ artifact, onRename, onDelete }: {
  artifact: LibraryArtifact
  onRename: (artifact: LibraryArtifact) => void
  onDelete: (artifact: LibraryArtifact) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const hostRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <span ref={hostRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={t('artifactsMoreActions')}
        title={t('artifactsMoreActions')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <span className="absolute right-0 top-full z-30 mt-1 flex w-40 flex-col rounded-xl border border-ds-border bg-ds-card p-1.5 text-left shadow-xl">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ds-ink hover:bg-ds-hover"
            onClick={() => { setOpen(false); onRename(artifact) }}
          >
            <PencilLine className="h-3.5 w-3.5" aria-hidden />{t('writeRenameEntry')}
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
            onClick={() => { setOpen(false); onDelete(artifact) }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />{t('writeEntryDialogDelete')}
          </button>
        </span>
      ) : null}
    </span>
  )
}
