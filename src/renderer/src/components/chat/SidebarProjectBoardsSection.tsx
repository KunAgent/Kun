import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Filter, Folder, FolderPlus, Search, X } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { readThreadWorktreeRegistry } from '../../lib/thread-worktree-registry'
import { removedWorkspaceIdentityKeys } from '../../lib/removed-code-workspaces'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'
import { useProjectBoardStore } from '../../project-board/project-board-store'
import { SidebarIconButton, SidebarSectionHeader } from '../sidebar/SidebarPrimitives'
import { buildSidebarWorkspaceGroups } from './sidebar-project-selectors'
import {
  readSidebarOrderRegistry,
  reconcileSidebarWorkspaceOrder
} from './sidebar-order'

type Props = {
  threads: NormalizedThread[]
  workspaceRoot: string
  workspaceRoots: string[]
  conversationRoot: string
  removedCodeWorkspaces: ReturnType<typeof import('../../lib/removed-code-workspaces').readRemovedCodeWorkspaces>
  runtimeReady: boolean
  onAddProject: () => void
  t: (key: string) => string
}

export function SidebarProjectBoardsSection({
  threads,
  workspaceRoot,
  workspaceRoots,
  conversationRoot,
  removedCodeWorkspaces,
  runtimeReady,
  onAddProject,
  t
}: Props): ReactElement {
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = useProjectBoardStore((state) => state.selectedWorkspaceRoot)
  const summaries = useProjectBoardStore((state) => state.summariesByWorkspace)
  const selectWorkspace = useProjectBoardStore((state) => state.selectWorkspace)
  const refreshSummaries = useProjectBoardStore((state) => state.refreshSummaries)
  const worktrees = readThreadWorktreeRegistry().worktrees
  const workspaces = useMemo(() => {
    const groups = buildSidebarWorkspaceGroups({
      threads,
      searchQuery: '',
      showArchived: false,
      workspaceRoot,
      workspaceRoots,
      conversationRoot,
      threadWorktrees: worktrees,
      removedProjectKeys: removedWorkspaceIdentityKeys(removedCodeWorkspaces)
    })
    const ordered = reconcileSidebarWorkspaceOrder(
      groups.map(([path]) => path),
      readSidebarOrderRegistry().workspacePaths
    )
    const query = search.trim().toLocaleLowerCase()
    return ordered.filter((path) => !query ||
      `${workspaceLabelFromPath(path)}\n${path}`.toLocaleLowerCase().includes(query))
  }, [conversationRoot, removedCodeWorkspaces, search, threads, workspaceRoot, workspaceRoots, worktrees])

  useEffect(() => {
    const all = workspaces.length ? workspaces : workspaceRoots
    const selectedStillExists = all.some((path) =>
      workspaceRootIdentityKey(path) === workspaceRootIdentityKey(selected))
    if (!selectedStillExists) {
      const fallback = all.find((path) =>
        workspaceRootIdentityKey(path) === workspaceRootIdentityKey(workspaceRoot)) ?? all[0]
      if (fallback) selectWorkspace(fallback)
    }
  }, [selectWorkspace, selected, workspaceRoot, workspaceRoots, workspaces])

  useEffect(() => {
    if (!runtimeReady || workspaces.length === 0) return
    const run = (): void => { void refreshSummaries(workspaces) }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 1_500 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(run, 200)
    return () => window.clearTimeout(timer)
  }, [refreshSummaries, runtimeReady, workspaces])

  return (
    <section className="ds-no-drag flex min-h-0 flex-1 flex-col">
      <SidebarSectionHeader
        label={t('projectBoardSection')}
        actions={(
          <>
            <SidebarIconButton title={t('projectBoardSearch')} onClick={() => setSearchOpen((open) => !open)}>
              {searchOpen ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
            </SidebarIconButton>
            <SidebarIconButton title={t('projectBoardFilterProjects')} disabled>
              <Filter className="h-3.5 w-3.5" />
            </SidebarIconButton>
            <SidebarIconButton title={t('projectBoardAddProject')} onClick={onAddProject}>
              <FolderPlus className="h-3.5 w-3.5" />
            </SidebarIconButton>
          </>
        )}
      />
      {searchOpen ? (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('projectBoardSearchProjects')}
            className="h-8 w-full rounded-lg border border-ds-border-muted bg-ds-main px-2.5 text-xs text-ds-ink outline-none focus:border-accent"
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 pb-3">
        {workspaces.map((path) => {
          const active = workspaceRootIdentityKey(path) === workspaceRootIdentityKey(selected)
          const summary = summaries[path]
          const parent = path.replace(/[\\/]+$/, '').split(/[\\/]/).slice(0, -1).join('/')
          return (
            <button
              key={workspaceRootIdentityKey(path)}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => selectWorkspace(path)}
              className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                active
                  ? 'border-ds-border bg-ds-card text-ds-ink shadow-sm'
                  : 'border-transparent text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'
              }`}
            >
              <Folder className="h-4 w-4 shrink-0" strokeWidth={1.65} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{workspaceLabelFromPath(path)}</span>
                <span className="block truncate text-[10.5px] text-ds-faint" title={path}>{parent || path}</span>
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-ds-faint">
                {summary ? `${summary.completed}/${summary.total}` : '—'}
              </span>
            </button>
          )
        })}
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-ds-faint">
            <Folder className="h-6 w-6" strokeWidth={1.4} />
            <span>{t('projectBoardNoProjects')}</span>
            <button type="button" onClick={onAddProject} className="text-accent hover:underline">
              {t('projectBoardAddProject')}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
