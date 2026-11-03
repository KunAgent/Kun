import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Folder, FolderInput, FolderPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  MAX_FOLDER_DEPTH,
  folderDisplayPath,
  importFolderLabel,
  setImportFolder,
  useImportFolder
} from '../../../paper/paper-import-target'
import { PaperFolderTree, usePaperLibraryLocation } from './PaperFolderTree'

const MENU_WIDTH = 296
const MENU_MAX_HEIGHT = 420
/** Header + footer chrome around the tree. */
const MENU_CHROME = 112

type MenuPosition = { left: number; top?: number; bottom?: number; maxHeight: number }

function menuPosition(anchor: HTMLElement): MenuPosition {
  const rect = anchor.getBoundingClientRect()
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - MENU_WIDTH - 8)
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  return below >= MENU_MAX_HEIGHT || below >= above
    ? { left, top: rect.bottom + 4, maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(0, below)) }
    : { left, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(0, above)) }
}

/**
 * "Import to <folder>" chip shared by every paper import entry point. The
 * menu shows the library's folders as a directory tree (with paper counts);
 * "New folder" makes one inside the highlighted folder. The choice is
 * remembered per library.
 */
export function PaperImportFolderPicker({
  showPrefix = true,
  className = ''
}: {
  showPrefix?: boolean
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const folder = useImportFolder()
  const { location } = usePaperLibraryLocation()
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const open = position !== null

  const close = (): void => {
    setPosition(null)
    setCreatingIn(null)
  }

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    setPosition(menuPosition(anchorRef.current))
  }, [open, creatingIn])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const choose = (next: string): void => {
    setImportFolder(next)
    close()
  }

  const rootLabel = t('paperImportFolderRoot')
  const label = folderDisplayPath(folder, rootLabel)
  const canNest = (folder ? folder.split('/').length : 0) < MAX_FOLDER_DEPTH

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('paperImportFolderTooltip', { folder: folder || rootLabel })}
        onClick={() => (open ? close() : setPosition(menuPosition(anchorRef.current!)))}
        className={`inline-flex h-7 min-w-0 max-w-[220px] shrink items-center gap-1.5 rounded-md px-2 text-[12px] transition ${
          open ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
        } ${className}`}
      >
        <FolderInput className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
        {showPrefix ? <span className="shrink-0 text-ds-faint">{t('paperImportFolderTo')}</span> : null}
        <span className="min-w-0 truncate font-medium text-ds-ink">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="dialog"
              aria-label={t('paperImportFolderTitle')}
              style={{ left: position.left, top: position.top, bottom: position.bottom, width: MENU_WIDTH, maxHeight: position.maxHeight }}
              className="ds-no-drag fixed z-[90] flex flex-col rounded-xl border border-ds-border bg-ds-elevated p-1.5 shadow-[0_16px_48px_rgba(15,23,42,0.18)]"
            >
              <div className="px-2 pb-1.5 pt-1">
                <div className="text-[12px] font-medium text-ds-ink">{t('paperImportFolderTitle')}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ds-faint" title={location}>
                  <Folder className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                  <span className="min-w-0 truncate">{location}</span>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <PaperFolderTree
                  value={folder}
                  onChange={choose}
                  creatingIn={creatingIn}
                  onCreatingChange={setCreatingIn}
                  onCreated={choose}
                  maxHeight={Math.max(120, position.maxHeight - MENU_CHROME)}
                />
              </div>
              <div className="mt-1 border-t border-ds-border-muted pt-1">
                <button
                  type="button"
                  disabled={!canNest || creatingIn !== null}
                  title={canNest ? undefined : t('paperFolderTooDeep', { max: MAX_FOLDER_DEPTH })}
                  onClick={() => setCreatingIn(folder)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
                >
                  <FolderPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span className="min-w-0 truncate">
                    {t('paperFolderNewIn', { folder: importFolderLabel(folder, rootLabel) })}
                  </span>
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
