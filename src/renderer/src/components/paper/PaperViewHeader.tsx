import type { ReactElement, ReactNode } from 'react'

/**
 * Slim header shared by paper-mode center views (search, discover sources):
 * leading control or icon + title on the left, view actions on the right —
 * the same height and rhythm as the Code conversation header.
 */
export function PaperViewHeader({
  leading,
  icon,
  title,
  meta,
  actions
}: {
  leading?: ReactNode
  icon?: ReactNode
  title?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}): ReactElement {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-ds-border-muted px-4">
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon ? <span className="flex shrink-0 text-ds-muted">{icon}</span> : null}
        {title ? <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">{title}</span> : null}
        {meta ? <span className="min-w-0 shrink-0 truncate text-[11.5px] text-ds-faint">{meta}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  )
}

/** Icon button sized for PaperViewHeader. */
export function PaperHeaderIconButton({
  label,
  onClick,
  children,
  disabled,
  active
}: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  /** Pinned/toggled state (accent tint). */
  active?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40 ${
        active ? 'bg-accent-tint/15 text-accent' : 'text-ds-muted'
      }`}
    >
      {children}
    </button>
  )
}
