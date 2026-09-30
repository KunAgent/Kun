import { useMemo, useState, type ReactElement } from 'react'
import { ChevronRight, Folder, FolderOpen, Import, Loader2, MoreHorizontal, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../../write/write-workspace-store'
import { normalizePath } from '../../../write/write-workspace-store-helpers'
import { usePaperStore } from '../../../write/paper/paper-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { confirmDialog } from '../../../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../../../lib/format-workspace-picker-error'
import { revealWorkspacePathInFileManager } from '../../../lib/open-workspace-path'
import {
  registerPaperLibrary,
  removePaperLibrary,
  switchPaperLibrary
} from '../../../paper/paper-mode-actions'
import { refreshPaperLibrary } from '../../../paper/paper-library-index'
import { SidebarIconButton, SidebarSectionHeader } from '../../sidebar/SidebarPrimitives'
import { PaperTree } from './PaperTree'
import { PaperWorkspaceMenu, type PaperWorkspaceMenuAction } from './PaperWorkspaceMenu'
import { usePaperSidebarLibraries } from './use-paper-sidebar-libraries'
import { readCollapsedWorkspaces, writeCollapsedWorkspaces } from './paper-sidebar-collapse'

/** Last path segment; when several roots share it, prepend the parent segment. */
function workspaceLabel(root: string, duplicateBases: ReadonlySet<string>): string {
  const base = writeBasenameFromPath(root) || root
  if (!duplicateBases.has(base.toLowerCase())) return base
  const trimmed = root.replace(/\/+$/, '')
  const parent = trimmed.slice(0, trimmed.length - base.length).replace(/\/+$/, '')
  const parentBase = writeBasenameFromPath(parent)
  return parentBase ? `${parentBase}/${base}` : base
}

/**
 * 「工作空间」 section: every configured library listed as its own tree —
 * root row (collapse, name, count, ⋮ menu) then its folders and papers.
 * Non-active roots are indexed lazily while expanded; all row actions run
 * against the tree's own root so same-named units never collide.
 */
export function PaperWorkspacesSection(): ReactElement {
  const { t } = useTranslation('common')
  const setFileError = useWriteWorkspaceStore((s) => s.setFileError)
  const setImportDialogOpen = usePaperModeStore((s) => s.setImportDialogOpen)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsedWorkspaces())
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [creatingFolderRoot, setCreatingFolderRoot] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ root: string; x: number; y: number } | null>(null)

  const { roots, activeRoot, byRoot } = usePaperSidebarLibraries(collapsed)

  const labels = useMemo(() => {
    const baseCounts = new Map<string, number>()
    for (const root of roots) {
      const base = (writeBasenameFromPath(root) || root).toLowerCase()
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
    }
    const duplicates = new Set([...baseCounts.entries()].filter(([, n]) => n > 1).map(([base]) => base))
    return new Map(roots.map((root) => [root, workspaceLabel(root, duplicates)]))
  }, [roots])

  const setWorkspaceCollapsed = (root: string, next: boolean): void => {
    setCollapsed((current) => {
      const updated = new Set(current)
      if (next) updated.add(root)
      else updated.delete(root)
      writeCollapsedWorkspaces(updated)
      return updated
    })
  }

  const addWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(activeRoot || undefined)
      if (picked.canceled || !picked.path) return
      const normalized = normalizePath(picked.path)
      const result = await registerPaperLibrary(normalized)
      if (!result.ok) setFileError(result.message)
      else setWorkspaceCollapsed(normalized, false)
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const importInto = async (root: string): Promise<void> => {
    if (root !== activeRoot) {
      const switched = await switchPaperLibrary(root)
      if (!switched.ok) {
        if (switched.message !== 'switch-canceled') {
          usePaperStore.getState().setNotice({
            tone: 'error',
            message: switched.message === 'save-failed' ? t('writePaperSaveFailed') : switched.message
          })
        }
        return
      }
    }
    setImportDialogOpen(true)
  }

  const removeWorkspace = async (root: string): Promise<void> => {
    if (!(await confirmDialog(
      t('writePaperModeRemoveLibraryConfirm', { name: labels.get(root) ?? root })
    ))) return
    const result = await removePaperLibrary(root)
    if (!result.ok) setFileError(result.message)
  }

  const onMenuAction = (root: string, action: PaperWorkspaceMenuAction): void => {
    switch (action) {
      case 'reveal':
        void revealWorkspacePathInFileManager(root, root)
        return
      case 'import':
        void importInto(root)
        return
      case 'new-folder':
        setWorkspaceCollapsed(root, false)
        setCreatingFolderRoot(root)
        return
      case 'remove':
        void removeWorkspace(root)
    }
  }

  return (
    <section className="ds-no-drag flex min-h-0 flex-1 flex-col">
      <SidebarSectionHeader
        label={t('paperWorkspaces')}
        actions={(
          <>
            <SidebarIconButton
              title={t('paperWorkspaceFilterTitle')}
              ariaLabel={t('paperWorkspaceFilterTitle')}
              active={filterOpen}
              onClick={() => {
                setFilterOpen((open) => !open)
                if (filterOpen) setFilter('')
              }}
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            </SidebarIconButton>
            <SidebarIconButton
              title={t('paperWorkspaceAdd')}
              ariaLabel={t('paperWorkspaceAdd')}
              onClick={() => void addWorkspace()}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
            </SidebarIconButton>
          </>
        )}
      />
      {filterOpen ? (
        <div className="mx-2 mb-1 flex h-7 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-main px-2">
          <Search className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setFilter('')
                setFilterOpen(false)
              }
            }}
            placeholder={t('paperWorkspaceFilterPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          {filter ? (
            <button type="button" onClick={() => setFilter('')} className="text-ds-faint hover:text-ds-ink">
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {roots.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-ds-faint">{t('writePaperModeNoLibraries')}</p>
        ) : null}
        {roots.map((root) => {
          const slice = byRoot[root]
          const expanded = !collapsed.has(root)
          const active = root === activeRoot
          return (
            <div key={root} className="mt-0.5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setWorkspaceCollapsed(root, expanded)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setWorkspaceCollapsed(root, expanded)
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ root, x: event.clientX, y: event.clientY })
                }}
                title={root}
                className="group/workspace flex h-7 w-full cursor-default items-center gap-1 rounded-md px-2 pr-1.5 text-[12.5px] transition hover:bg-ds-hover"
              >
                <ChevronRight
                  className={`h-3 w-3 shrink-0 text-ds-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
                  strokeWidth={2}
                />
                {expanded ? (
                  <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-muted'}`} strokeWidth={1.8} />
                ) : (
                  <Folder className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-muted'}`} strokeWidth={1.8} />
                )}
                <span className={`min-w-0 flex-1 truncate ${active ? 'font-medium text-ds-ink' : 'text-ds-muted group-hover/workspace:text-ds-ink'}`}>
                  {labels.get(root) ?? root}
                </span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-ds-faint group-hover/workspace:invisible">
                  {slice?.status === 'loading' ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  ) : slice?.status === 'ready' ? (
                    slice.counts.total
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={t('paperWorkspaceMenu')}
                  title={t('paperWorkspaceMenu')}
                  onClick={(event) => {
                    event.stopPropagation()
                    setMenu({ root, x: event.clientX, y: event.clientY })
                  }}
                  className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ds-faint transition hover:bg-ds-main hover:text-ds-ink group-hover/workspace:flex"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>

              {expanded ? (
                slice?.status === 'error' ? (
                  <div className="flex items-center gap-1.5 py-1 pl-9 pr-2 text-[11.5px] text-red-600 dark:text-red-300">
                    <span className="min-w-0 flex-1 truncate" title={slice.error ?? ''}>
                      {t('paperWorkspaceLoadError')}
                    </span>
                    <button
                      type="button"
                      onClick={() => refreshPaperLibrary(root)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-muted hover:bg-ds-hover"
                    >
                      <RotateCcw className="h-2.5 w-2.5" strokeWidth={2} />
                      {t('paperWorkspaceRetry')}
                    </button>
                  </div>
                ) : slice?.status === 'loading' && !slice.entries.length ? (
                  <p className="flex items-center gap-1.5 py-1.5 pl-9 text-[11.5px] text-ds-faint">
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    {t('paperWorkspaceScanning')}
                  </p>
                ) : (
                  <>
                    {slice && !slice.entries.length && !slice.groups.length && !filter.trim() ? (
                      <button
                        type="button"
                        onClick={() => void importInto(root)}
                        className="flex h-7 w-full items-center gap-1.5 rounded-md pl-9 pr-2 text-[12px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                      >
                        <Import className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                        {t('writePaperImport')}
                      </button>
                    ) : (
                      <PaperTree
                        libraryRoot={root}
                        entries={slice?.entries ?? []}
                        groups={slice?.groups ?? []}
                        filter={filter}
                        creatingFolder={creatingFolderRoot === root}
                        onCreatingFolderDone={() => setCreatingFolderRoot(null)}
                      />
                    )}
                  </>
                )
              ) : null}
            </div>
          )
        })}
      </div>

      {menu ? (
        <PaperWorkspaceMenu
          x={menu.x}
          y={menu.y}
          canRemove={roots.length > 1}
          onAction={(action) => onMenuAction(menu.root, action)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  )
}
