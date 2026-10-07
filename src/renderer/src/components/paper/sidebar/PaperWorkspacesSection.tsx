import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { ChevronRight, Folder, FolderOpen, Import, Loader2, MoreHorizontal, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { confirmDialog } from '../../../lib/confirm-dialog'
import { revealWorkspacePathInFileManager } from '../../../lib/open-workspace-path'
import { removePaperLibrary } from '../../../paper/paper-mode-actions'
import { usePaperWorkspaceBootstrapStore } from '../../../paper/paper-workspace-bootstrap'
import { usePaperWorkspaceActions } from '../use-paper-workspace-actions'
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
 * root row (independent collapse, switch, count, ⋮ menu) then its folders and papers.
 * Non-active roots are indexed lazily while expanded; all row actions run
 * against the tree's own root so same-named units never collide.
 */
export function PaperWorkspacesSection({ variant = 'standalone' }: {
  /** `embedded` sits in the Work directory list: compact label, shared scroll. */
  variant?: 'standalone' | 'embedded'
} = {}): ReactElement {
  const embedded = variant === 'embedded'
  const { t } = useTranslation('common')
  const defaultRoot = usePaperWorkspaceBootstrapStore((s) => s.defaultWorkspaceRoot)
  const { busy, error, run, switchWorkspace, chooseWorkspace } = usePaperWorkspaceActions()
  const setImportDialogOpen = usePaperModeStore((s) => s.setImportDialogOpen)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsedWorkspaces())
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [creatingFolderRoot, setCreatingFolderRoot] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ root: string; x: number; y: number } | null>(null)

  const { roots, activeRoot, byRoot } = usePaperSidebarLibraries(collapsed)
  const closeMenu = useCallback(() => setMenu(null), [])

  const labels = useMemo(() => {
    const baseCounts = new Map<string, number>()
    for (const root of roots) {
      const base = (writeBasenameFromPath(root) || root).toLowerCase()
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
    }
    const duplicates = new Set([...baseCounts.entries()].filter(([, n]) => n > 1).map(([base]) => base))
    return new Map(roots.map((root) => [root, root === defaultRoot ? t('paperWorkspaceDefaultName') : workspaceLabel(root, duplicates)]))
  }, [roots, defaultRoot, t])

  const setWorkspaceCollapsed = (root: string, next: boolean): void => {
    setCollapsed((current) => {
      const updated = new Set(current)
      if (next) updated.add(root)
      else updated.delete(root)
      writeCollapsedWorkspaces(updated)
      return updated
    })
  }

  const activateWorkspace = async (root: string): Promise<boolean> => {
    const switched = await switchWorkspace(root)
    if (switched) setWorkspaceCollapsed(root, false)
    return switched
  }

  const importInto = async (root: string): Promise<void> => {
    if (busy) return
    if (root !== activeRoot && !(await activateWorkspace(root))) return
    setImportDialogOpen(true)
  }

  const addWorkspace = async (): Promise<void> => {
    if (await chooseWorkspace()) {
      setWorkspaceCollapsed(useWriteWorkspaceStore.getState().workspaceRoot, false)
    }
  }

  const removeWorkspace = (root: string): Promise<boolean> => run(async () => {
    if (!(await confirmDialog(
      t('writePaperModeRemoveLibraryConfirm', { name: labels.get(root) ?? root })
    ))) return { ok: false, message: 'switch-canceled' }
    return removePaperLibrary(root)
  })

  const onMenuAction = (root: string, action: PaperWorkspaceMenuAction): void => {
    if (busy) return
    switch (action) {
      case 'switch':
        void activateWorkspace(root)
        return
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
    <section aria-busy={busy} data-paper-libraries
      className={embedded ? 'ds-no-drag mt-2 flex flex-col' : 'ds-no-drag flex min-h-0 flex-1 flex-col'}>
      <SidebarSectionHeader
        label={embedded ? t('workSidebarLibraries') : t('paperWorkspaces')}
        compact={embedded}
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
              disabled={busy}
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
            aria-label={t('paperWorkspaceFilterPlaceholder')}
            placeholder={t('paperWorkspaceFilterPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          {filter ? (
            <button type="button" aria-label={t('clearSearch')} onClick={() => setFilter('')} className="text-ds-faint hover:text-ds-ink">
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p role="alert" className="mx-3 mb-2 break-words text-[11.5px] text-red-600 dark:text-red-300">{error}</p> : null}
      <div className={embedded ? 'pb-1' : 'min-h-0 flex-1 overflow-y-auto pb-2'}>
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
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (!busy) setMenu({ root, x: event.clientX, y: event.clientY })
                }}
                title={root}
                className={`group/workspace flex min-h-8 w-full items-center gap-0.5 rounded-md px-1 text-[12.5px] transition ${active ? 'bg-accent-tint/10' : 'hover:bg-ds-hover'}`}
              >
                <button
                  type="button"
                  data-testid="paper-workspace-collapse"
                  data-workspace-root={root}
                  aria-label={t(expanded ? 'paperWorkspaceCollapse' : 'paperWorkspaceExpand', { name: labels.get(root) ?? root })}
                  aria-expanded={expanded}
                  onClick={() => setWorkspaceCollapsed(root, expanded)}
                  className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-ds-faint hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-testid="paper-workspace-switch"
                  data-workspace-root={root}
                  aria-current={active ? 'true' : undefined}
                  aria-label={t('paperWorkspaceOpenNamed', { name: labels.get(root) ?? root })}
                  title={root}
                  disabled={busy}
                  onClick={() => void activateWorkspace(root)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
                >
                  {expanded ? (
                    <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-muted'}`} strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <Folder className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-muted'}`} strokeWidth={1.8} aria-hidden="true" />
                  )}
                  <span className={`min-w-0 flex-1 truncate ${active ? 'font-medium text-ds-ink' : 'text-ds-muted group-hover/workspace:text-ds-ink'}`}>
                    {labels.get(root) ?? root}
                  </span>
                  {active ? <span className="shrink-0 rounded bg-accent-tint/10 px-1 py-0.5 text-[9px] font-medium text-accent">{t('paperWorkspaceActive')}</span> : null}
                </button>
                <span className="shrink-0 px-1 text-[10.5px] tabular-nums text-ds-faint">
                  {slice?.status === 'loading' ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} aria-label={t('loading')} />
                  ) : slice?.status === 'ready' ? slice.counts.total : null}
                </span>
                <button
                  type="button"
                  aria-label={t('paperWorkspaceMenuNamed', { name: labels.get(root) ?? root })}
                  title={t('paperWorkspaceMenu')}
                  aria-haspopup="menu"
                  aria-expanded={menu?.root === root}
                  disabled={busy}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setMenu({ root, x: rect.left, y: rect.bottom + 4 })
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ds-faint transition hover:bg-ds-main hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
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
                    {slice && !slice.entries.length && !slice.groups.length && !filter.trim() && creatingFolderRoot !== root ? (
                      <button
                        type="button"
                        disabled={busy}
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
          active={menu.root === activeRoot}
          canRemove={roots.length > 1}
          onAction={(action) => onMenuAction(menu.root, action)}
          onClose={closeMenu}
        />
      ) : null}
    </section>
  )
}
