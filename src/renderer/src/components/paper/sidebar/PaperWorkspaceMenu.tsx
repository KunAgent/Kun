import { useEffect, useRef, type ReactElement } from 'react'
import { ArrowRightLeft, FolderPlus, FolderSearch, Import, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type PaperWorkspaceMenuAction = 'switch' | 'reveal' | 'import' | 'new-folder' | 'remove'

const MENU_WIDTH = 216
const MENU_HEIGHT = 214

/**
 * Workspace root-row context menu (right click or the hover "more" button):
 * reveal in the file manager, import papers, create a folder, or remove the
 * workspace from the list (files on disk are never touched).
 */
export function PaperWorkspaceMenu({
  x,
  y,
  canRemove,
  active,
  onAction,
  onClose
}: {
  x: number
  y: number
  canRemove: boolean
  active: boolean
  onAction: (action: PaperWorkspaceMenuAction) => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    node?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
      if (node?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus?.()
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
      aria-label={t('paperWorkspaceMenu')}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}
      style={{ left, top, width: MENU_WIDTH }}
      className="ds-no-drag fixed z-[70] rounded-xl border border-[var(--ds-border-strong)] bg-ds-card p-1 shadow-[0_18px_48px_rgba(20,47,95,0.18)]"
    >
      <button
        type="button"
        role="menuitem"
        disabled={active}
        onClick={() => run('switch')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:text-ds-faint"
      >
        <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        {t(active ? 'paperWorkspaceCurrent' : 'paperWorkspaceSwitch')}
      </button>
      <div className="my-1 border-t border-ds-border-muted" />
      <button
        type="button"
        role="menuitem"
        onClick={() => run('import')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Import className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        {t('writePaperImport')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run('new-folder')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <FolderPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        {t('paperImportFolderNew')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run('reveal')}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-red-600 transition hover:bg-ds-hover dark:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            {t('paperWorkspaceRemove')}
          </button>
        </>
      ) : null}
    </div>
  )
}
