import { useCallback, useId, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FolderGit2, GitBranch, Loader2 } from 'lucide-react'
import type { TaskWorkspacePrep } from '../../store/task-workspace-store'
import { useComposerPickerPopover } from './use-composer-picker-popover'

const MENU_WIDTH = 288
const MENU_ESTIMATED_HEIGHT = 140

type Props = {
  disabled?: boolean
  /** New-session isolation choice; only shown before the thread exists. */
  showPicker: boolean
  value: 'local' | 'worktree'
  /** Prep state on the bound thread — progress chip or retry affordance. */
  prep?: TaskWorkspacePrep
  /** Bound task-workspace id when the thread already has one. */
  boundWorkspaceId?: string
  onSelect: (value: 'local' | 'worktree') => void
  onRetryPrep?: () => void
}

/** ADE-only isolation control (12 §7.3): local dir vs host-managed worktree. */
export function FloatingComposerIsolationPicker({
  disabled = false,
  showPicker,
  value,
  prep,
  boundWorkspaceId,
  onSelect,
  onRetryPrep
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const menuId = useId()

  const closeMenu = useCallback((): void => setOpen(false), [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open,
    onClose: closeMenu,
    preferredWidth: MENU_WIDTH,
    estimatedHeight: MENU_ESTIMATED_HEIGHT
  })

  const preparing = prep && (prep.state === 'creating' || prep.state === 'setting-up')
  const failed = prep?.state === 'failed'

  const options: Array<{ id: 'local' | 'worktree'; title: string; description: string }> = [
    {
      id: 'local',
      title: t('adeIsolation.local'),
      description: t('adeIsolation.localHint')
    },
    {
      id: 'worktree',
      title: t('adeIsolation.worktree'),
      description: t('adeIsolation.worktreeHint')
    }
  ]

  const menu = open && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={t('adeIsolation.title')}
      style={{ ...menuStyle, overflowY: 'auto' }}
      data-isolation-picker-menu
      className="ds-composer-isolation-menu ds-no-drag fixed z-50 overflow-hidden rounded-lg border border-ds-border bg-ds-main shadow-xl"
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-ds-faint">
        {t('adeIsolation.title')}
      </div>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => {
            onSelect(option.id)
            setOpen(false)
          }}
          className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-ds-hover ${value === option.id ? 'bg-ds-subtle' : ''}`}
          data-isolation={option.id}
        >
          {option.id === 'worktree' ? (
            <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
          ) : (
            <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ds-ink">{option.title}</span>
            <span className="block truncate text-[11px] text-ds-faint">
              {option.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="flex items-center gap-1.5">
      {showPicker ? (
        <>
          <div className="ds-composer-isolation-picker ds-no-drag relative">
            <button
              ref={triggerRef}
              type="button"
              disabled={disabled}
              aria-haspopup="menu"
              aria-controls={menuId}
              aria-expanded={open}
              onClick={() => setOpen((s) => !s)}
              className="flex h-7 items-center gap-1 rounded-full border border-ds-border bg-ds-raised px-2 text-xs text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
              title={t('adeIsolation.title')}
              aria-label={t('adeIsolation.title')}
              data-composer-isolation-picker
            >
              {value === 'worktree' ? (
                <GitBranch className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <FolderGit2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              <span className="max-w-[120px] truncate">
                {value === 'worktree' ? t('adeIsolation.worktree') : t('adeIsolation.local')}
              </span>
            </button>
          </div>
          {menu ? createPortal(menu, document.body) : null}
        </>
      ) : null}
      {preparing ? (
        <span
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ds-border bg-ds-raised px-2 text-[11px] font-medium text-ds-muted"
          data-worktree-prep="preparing"
          title={prep?.progress?.message ?? t('adeIsolation.preparing')}
        >
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
          <span className="max-w-[160px] truncate">
            {prep?.progress?.message ?? t('adeIsolation.preparing')}
          </span>
        </span>
      ) : failed ? (
        <button
          type="button"
          onClick={onRetryPrep}
          disabled={disabled}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-300/60 bg-red-500/10 px-2 text-[11px] font-medium text-red-700 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-400/40 dark:text-red-200"
          data-worktree-prep="failed"
          title={prep?.error ?? t('adeIsolation.prepFailed')}
        >
          {t('adeIsolation.prepFailedRetry')}
        </button>
      ) : prep?.state === 'ready' || (!prep && boundWorkspaceId) ? (
        <span
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ds-border bg-ds-raised px-2 text-[11px] font-medium text-ds-muted"
          data-worktree-prep="ready"
          title={prep?.path ?? boundWorkspaceId}
        >
          <GitBranch className="h-3 w-3" strokeWidth={1.75} />
          <span className="max-w-[160px] truncate">
            {(prep?.path ?? '').split('/').filter(Boolean).pop() ?? t('adeIsolation.worktree')}
          </span>
        </span>
      ) : null}
    </div>
  )
}
