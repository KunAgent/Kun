import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import {
  BookOpen,
  Copy,
  Download,
  FolderInput,
  FolderSearch,
  PencilLine,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperReadingStatus } from '@shared/paper/paper-meta-v2'

export type PaperRowMenuAction =
  | 'open'
  | 'edit'
  | 'copy-bibtex'
  | 'download-pdf'
  | 'reveal'
  | 'move'
  | 'trash'
  | { status: PaperReadingStatus }

const MENU_WIDTH = 220
const MENU_MAX_HEIGHT = 340

/**
 * Library row context menu (right click or the row's "more" button). Placed
 * at the pointer and clamped into the viewport; closes on outside pointer
 * down, Escape, scroll, or after an action.
 */
export function PaperRowMenu({
  entry,
  x,
  y,
  onAction,
  onClose
}: {
  entry: PaperLibraryEntry
  x: number
  y: number
  onAction: (action: PaperRowMenuAction) => void
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
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8))
  const status = entry.meta.status ?? 'unread'
  const run = (action: PaperRowMenuAction): void => {
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
      <Item icon={<BookOpen />} label={t('writePaperMenuOpen')} onClick={() => run('open')} />
      <Item icon={<PencilLine />} label={t('writePaperEditMeta')} onClick={() => run('edit')} />
      {!entry.hasPdf ? (
        <Item icon={<Download />} label={t('writePaperDownloadPdf')} onClick={() => run('download-pdf')} />
      ) : null}
      <Item icon={<Copy />} label={t('writePaperCopyBibtex')} onClick={() => run('copy-bibtex')} />
      <Item icon={<FolderInput />} label={t('writePaperMoveToGroup')} onClick={() => run('move')} />
      <Item
        icon={<FolderSearch />}
        label={window.kunGui?.platform === 'darwin' ? t('fileTreeRevealInFinder') : t('fileTreeRevealInFileManager')}
        onClick={() => run('reveal')}
      />
      <div className="my-1 border-t border-ds-border-muted" />
      <div className="flex gap-1 px-1.5 py-1">
        {(['unread', 'reading', 'read'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={status === value}
            onClick={() => run({ status: value })}
            className={`flex-1 rounded-full border px-1.5 py-0.5 text-[11px] transition ${
              status === value
                ? 'border-accent-tint/50 bg-accent-tint/10 text-accent'
                : 'border-ds-border-muted text-ds-muted hover:bg-ds-hover'
            }`}
          >
            {t(value === 'unread' ? 'writePaperFilterUnread' : value === 'reading' ? 'writePaperFilterReading' : 'writePaperFilterRead')}
          </button>
        ))}
      </div>
      <div className="my-1 border-t border-ds-border-muted" />
      <Item icon={<Trash2 />} label={t('writePaperTrash')} danger onClick={() => run('trash')} />
    </div>
  )
}

function Item({
  icon,
  label,
  danger,
  onClick
}: {
  icon: ReactElement
  label: ReactNode
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition hover:bg-ds-hover ${
        danger ? 'text-red-600 dark:text-red-300' : 'text-ds-ink'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
