import { useCallback, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, GitBranch, Loader2, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TaskWorkspaceStartFrom } from '@shared/task-workspace'
import type { useAdeWorktreeGit } from './use-ade-worktree-git'
import { useComposerPickerPopover } from './use-composer-picker-popover'

type GitState = ReturnType<typeof useAdeWorktreeGit>

export function AdeWorktreeStartPicker({ git }: { git: GitState }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const close = useCallback((): void => { setOpen(false); setQuery('') }, [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open,
    onClose: close,
    preferredWidth: 320,
    estimatedHeight: 400,
    maximumHeight: 480
  })
  const select = (startFrom: TaskWorkspaceStartFrom): void => {
    git.selectStartFrom(startFrom)
    close()
  }
  const label = git.startFrom.kind === 'current-head'
    ? t('adeWorktreeStart.currentHead')
    : git.startFrom.kind === 'branch'
      ? git.startFrom.name
      : t('adeWorktreeStart.defaultBranch')
  const branches = git.branches?.branches.filter((branch) =>
    branch.name.toLowerCase().includes(query.trim().toLowerCase())) ?? []

  const menu = open && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('adeWorktreeStart.title')}
      style={{ ...menuStyle, overflowY: 'auto' }}
      className="ds-no-drag fixed z-50 overflow-hidden rounded-xl border border-ds-border bg-ds-elevated shadow-[0_24px_70px_rgba(44,55,78,0.18)]"
      data-ade-worktree-start-menu
    >
      <div className="border-b border-ds-border-muted px-3 py-2 text-xs font-medium text-ds-faint">
        {t('adeWorktreeStart.title')}
      </div>
      {git.status === 'loading' || git.status === 'idle' ? (
        <div className="flex items-center gap-2 px-3 py-4 text-sm text-ds-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />{t('adeWorktreeStart.checking')}
        </div>
      ) : git.status !== 'ready' ? (
        <div className="space-y-2 px-3 py-3 text-sm text-ds-muted" role="status">
          <p>{git.status === 'not-git' ? t('adeWorktreeStart.notGit') :
            git.error || t('adeWorktreeStart.checkFailed')}</p>
          <button type="button" onClick={git.retry} className="inline-flex items-center gap-1 text-ds-ink hover:underline">
            <RefreshCw className="h-3.5 w-3.5" />{t('adeWorktreeStart.retry')}
          </button>
        </div>
      ) : (
        <>
          {!git.selectedBranchValid ? (
            <div className="mx-3 mt-2 text-xs text-red-600 dark:text-red-300" role="alert">
              {t('adeWorktreeStart.branchMissing')}
            </div>
          ) : null}
          <div className="p-2">
            <button
              type="button"
              role="menuitem"
              onClick={() => select({ kind: 'default-branch' })}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ds-hover"
              data-ade-worktree-start="default-branch"
            >
              <span className="min-w-0 flex-1">{t('adeWorktreeStart.defaultBranch')}</span>
              {git.startFrom.kind === 'default-branch' ? <Check className="h-4 w-4" /> : null}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => select({ kind: 'current-head' })}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ds-hover"
              data-ade-worktree-start="current-head"
            >
              <span className="min-w-0 flex-1 truncate">
                {t('adeWorktreeStart.currentHead')}
                {git.branches?.currentBranch ? <span className="ml-1 text-xs text-ds-faint">({git.branches.currentBranch})</span> : null}
              </span>
              {git.startFrom.kind === 'current-head' ? <Check className="h-4 w-4" /> : null}
            </button>
          </div>
          <div className="border-t border-ds-border-muted px-3 py-2 text-xs font-medium text-ds-faint">
            {t('adeWorktreeStart.localBranch')}
          </div>
          <div className="flex items-center gap-2 px-3 pb-2">
            <Search className="h-3.5 w-3.5 text-ds-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t('adeWorktreeStart.searchBranch')}
              placeholder={t('adeWorktreeStart.searchBranch')}
              className="min-w-0 flex-1 bg-transparent text-sm text-ds-ink outline-none placeholder:text-ds-faint"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto px-2 pb-2">
            {branches.map((branch) => (
              <button
                key={branch.name}
                type="button"
                role="menuitem"
                onClick={() => select({ kind: 'branch', name: branch.name })}
                title={branch.name}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ds-hover"
                data-ade-worktree-start={`branch:${branch.name}`}
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
                <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                {git.startFrom.kind === 'branch' && git.startFrom.name === branch.name ?
                  <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            ))}
            {branches.length === 0 ? <p className="px-2 py-2 text-xs text-ds-faint">{t('adeWorktreeStart.noBranches')}</p> : null}
          </div>
        </>
      )}
      <div className="border-t border-ds-border-muted p-2">
        <button type="button" onClick={git.retry} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ds-muted hover:bg-ds-hover">
          <RefreshCw className="h-3.5 w-3.5" />{t('adeWorktreeStart.retry')}
        </button>
      </div>
    </div>
  ) : null

  return (
    <div className="ds-no-drag min-w-0" data-ade-worktree-start-picker>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('adeWorktreeStart.title')}
        onClick={() => {
          setOpen((value) => !value)
          if (!open) git.retry()
        }}
        title={git.error || label}
        className="inline-flex h-8 max-w-[min(220px,60vw)] min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {git.status === 'loading' ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> :
          <ChevronDown className="h-3 w-3 shrink-0" />}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
