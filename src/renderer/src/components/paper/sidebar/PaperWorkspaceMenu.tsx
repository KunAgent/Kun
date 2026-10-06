import { useEffect, useRef, type ReactElement } from 'react'
import { FolderPlus, FolderSearch, Import, Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type PaperWorkspaceMenuAction = 'reveal' | 'import' | 'new-folder' | 'remove' | 'batch-read'

const MENU_WIDTH = 216
const MENU_HEIGHT = 212

/**
 * Workspace root-row context menu (right click or the hover "more" button):
 * reveal in the file manager, import papers, create a folder, or remove the
 * workspace from the list (files on disk are never touched).
 */
export function PaperWorkspaceMenu({
  x,
  y,
  canRemove,
  canBatchRead = true,
  onAction,
  onClose
}: {
  x: number
  y: number
  canRemove: boolean
  canBatchRead?: boolean
  onAction: (action: PaperWorkspaceMenuAction) => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8))
  const run = (action: PaperWorkspaceMenuAction): void => {
    onClose()
    onAction(action)
  }

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top, width: MENU_WIDTH }}
      className="ds-no-drag fixed z-[70] rounded-xl border border-[var(--ds-border-strong)] bg-ds-card p-1 shadow-[0_18px_48px_rgba(20,47,95,0.18)]"
    >
      <button type="button" role="menuitem" onClick={() => run('batch-read')} disabled={!canBatchRead} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover disabled:opacity-40"><Sparkles className="h-3.5 w-3.5 shrink-0" />{t('paperBatchLibraryAction')}</button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run('import')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
      >
        <Import className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        {t('writePaperImport')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run('new-folder')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
      >
        <FolderPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        {t('paperImportFolderNew')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run('reveal')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
      >
        <FolderSearch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        {window.kunGui?.platform === 'darwin' ? t('fileTreeRevealInFinder') : t('fileTreeRevealInFileManager')}
      </button>
      {canRemove ? (
        <>
          <div className="my-1 border-t border-ds-border-muted" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run('remove')}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-red-600 transition hover:bg-ds-hover dark:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            {t('paperWorkspaceRemove')}
          </button>
        </>
      ) : null}
    </div>
  )
}
