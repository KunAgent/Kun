import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronsUpDown, FolderOpen, FolderSearch, LibraryBig, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { confirmDialog } from '../../../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../../../lib/format-workspace-picker-error'
import { revealWorkspacePathInFileManager } from '../../../lib/open-workspace-path'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath
} from '../../../write/write-workspace-store'
import { normalizePath } from '../../../write/write-workspace-store-helpers'
import {
  addPaperLibrary,
  removePaperLibrary,
  switchPaperLibrary
} from '../../../paper/paper-mode-actions'

/**
 * Compact library switcher pinned to the top of the paper sidebar (U3): shows
 * the active library name and opens a dropdown listing every registered
 * library with switch / reveal / remove affordances plus an add row.
 */
export function PaperLibrarySwitcher(): ReactElement {
  const { t } = useTranslation('common')
  const paperMode = useWriteWorkspaceStore((s) => s.paperMode)
  const setFileError = useWriteWorkspaceStore((s) => s.setFileError)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const activeLibrary = normalizePath(paperMode.activeLibrary)

  const pickLibrary = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(activeLibrary || undefined)
      if (!picked.canceled && picked.path) {
        const result = await addPaperLibrary(picked.path)
        if (!result.ok) setFileError(result.message)
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const removeLibrary = async (libraryPath: string): Promise<void> => {
    if (!(await confirmDialog(
      t('writePaperModeRemoveLibraryConfirm', { name: writeBasenameFromPath(libraryPath) })
    ))) return
    const result = await removePaperLibrary(libraryPath)
    if (!result.ok) setFileError(result.message)
  }

  return (
    <div ref={rootRef} className="relative px-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle/40 px-2 text-left transition hover:bg-ds-hover"
      >
        <LibraryBig className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ds-ink">
          {activeLibrary ? writeBasenameFromPath(activeLibrary) : t('writePaperModeAddLibrary')}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
      </button>
      {open ? (
        <div className="absolute inset-x-1.5 top-full z-30 mt-1 overflow-hidden rounded-xl border border-ds-border bg-ds-card py-1 shadow-lg">
          {paperMode.libraries.map((libraryPath) => {
            const normalized = normalizePath(libraryPath)
            const active = normalized === activeLibrary
            return (
              <div
                key={normalized}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setOpen(false)
                  if (!active) void switchPaperLibrary(libraryPath)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !active) void switchPaperLibrary(libraryPath)
                }}
                className={`group flex h-8 cursor-default items-center gap-1.5 px-2.5 text-[12px] transition hover:bg-ds-hover ${
                  active ? 'text-ds-ink' : 'text-ds-muted'
                }`}
                title={libraryPath}
              >
                <Check
                  className={`h-3 w-3 shrink-0 ${active ? 'text-accent' : 'opacity-0'}`}
                  strokeWidth={2.2}
                />
                <span className="min-w-0 flex-1 truncate">{writeBasenameFromPath(libraryPath)}</span>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    title={window.kunGui?.platform === 'darwin'
                      ? t('fileTreeRevealInFinder')
                      : t('fileTreeRevealInFileManager')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void revealWorkspacePathInFileManager(libraryPath, libraryPath)
                    }}
                    className="rounded p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <FolderSearch className="h-3 w-3" strokeWidth={1.8} />
                  </button>
                  {paperMode.libraries.length > 1 ? (
                    <button
                      type="button"
                      title={t('writePaperModeRemoveLibrary')}
                      onClick={(event) => {
                        event.stopPropagation()
                        void removeLibrary(libraryPath)
                      }}
                      className="rounded p-1 text-ds-faint hover:bg-ds-hover hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.8} />
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void pickLibrary()
            }}
            className="flex h-8 w-full items-center gap-1.5 border-t border-ds-border-muted px-2.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <Plus className="h-3 w-3 shrink-0" strokeWidth={1.9} />
            {t('writePaperModeAddLibrary')}
          </button>
          {paperMode.libraries.length === 0 ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] text-ds-faint">
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('writePaperModeNoLibraries')}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
