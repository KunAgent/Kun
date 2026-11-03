import type { ReactElement, ReactNode } from 'react'
import type { GitChangeEntry, GitChangeStatus } from '@shared/git-commit'
import { splitRepositoryPath, statusLetter } from './change-source'

const STATUS_TONE: Record<GitChangeStatus, string> = {
  modified: 'text-amber-700 dark:text-amber-300',
  typechange: 'text-amber-700 dark:text-amber-300',
  added: 'text-ds-diff-added',
  untracked: 'text-ds-diff-added',
  copied: 'text-ds-diff-added',
  renamed: 'text-sky-700 dark:text-sky-300',
  deleted: 'text-ds-diff-removed',
  conflicted: 'text-ds-diff-removed'
}

/** One file in a git list: status letter, name, folder, line counts and hover actions. */
export function GitChangeRow({
  entry,
  selected,
  statusLabel,
  onSelect,
  actions
}: {
  entry: GitChangeEntry
  selected: boolean
  statusLabel: string
  onSelect: () => void
  actions?: ReactNode
}): ReactElement {
  const { name, directory } = splitRepositoryPath(entry.path)
  const deleted = entry.status === 'deleted'
  return (
    <li
      className={`group flex h-[30px] items-center gap-1 rounded-[7px] pl-1 pr-1 ${
        selected ? 'bg-ds-hover' : 'hover:bg-ds-hover'
      }`}
      data-git-change-path={entry.path}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        title={entry.previousPath ? `${entry.previousPath} → ${entry.path}` : entry.path}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[6px] px-1.5 text-left text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span
          className={`w-3 shrink-0 text-center font-mono text-[11px] font-bold ${STATUS_TONE[entry.status]}`}
          aria-label={statusLabel}
          title={statusLabel}
        >
          {statusLetter(entry.status)}
        </span>
        <span className={`shrink-0 truncate font-medium ${deleted ? 'text-ds-muted line-through' : 'text-ds-ink'} max-w-[60%]`}>
          {name}
        </span>
        <span className="min-w-0 flex-1 truncate text-ds-muted">{directory}</span>
        {entry.additions !== null && entry.additions > 0 ? (
          <span className="shrink-0 font-mono text-[10.5px] text-ds-diff-added">+{entry.additions}</span>
        ) : null}
        {entry.deletions !== null && entry.deletions > 0 ? (
          <span className="shrink-0 font-mono text-[10.5px] text-ds-diff-removed">−{entry.deletions}</span>
        ) : null}
      </button>
      {actions ? (
        <span
          className={`flex shrink-0 items-center gap-0.5 ${
            selected ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          {actions}
        </span>
      ) : null}
    </li>
  )
}

export function GitRowAction({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-ds-muted hover:bg-ds-card hover:text-ds-ink focus-visible:ring-2 focus-visible:ring-accent-soft disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
