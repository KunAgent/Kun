import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode
} from 'react'
import { ChevronRight, Command, PanelLeft, Search, X } from 'lucide-react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type SidebarFrameProps = {
  title: string
  children: ReactNode
  footer?: ReactNode
  onCollapse?: () => void
  className?: string
}

type SidebarTitlebarToggleButtonProps = {
  title: string
  ariaLabel?: string
  onClick: () => void
  className?: string
  children?: ReactNode
}

export function SidebarTitlebarToggleButton({
  title,
  ariaLabel,
  onClick,
  className,
  children
}: SidebarTitlebarToggleButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cx('ds-titlebar-sidebar-toggle ds-no-drag', className)}
    >
      {children ?? <PanelLeft className="h-4 w-4" strokeWidth={1.75} />}
    </button>
  )
}

export function SidebarFrame({
  title,
  children,
  footer,
  onCollapse,
  className
}: SidebarFrameProps): ReactElement {
  return (
    <aside
      className={cx(
        'ds-drag ds-sidebar-shell relative flex h-full w-full shrink-0 flex-col overflow-hidden px-4 pb-3',
        className
      )}
    >
      <div className="ds-sidebar-titlebar-spacer shrink-0 pb-2 pt-2">
        <div className="ds-sidebar-titlebar-row flex min-h-[34px] items-start justify-between">
          <div aria-hidden className="ds-titlebar-safe-block min-w-[86px]" />
          {onCollapse ? (
            <SidebarTitlebarToggleButton
              onClick={onCollapse}
              title={title}
              ariaLabel={title}
              className="ds-sidebar-titlebar-toggle mt-[5px]"
            />
          ) : null}
        </div>
      </div>

      {children}

      {footer ? (
        <div className="ds-sidebar-footer ds-no-drag mt-2 border-t border-[var(--ds-sidebar-divider)] px-1.5 pt-3">
          {footer}
        </div>
      ) : null}
    </aside>
  )
}

type SidebarCommandRowProps = {
  icon: ReactElement
  label: string
  onClick?: () => void
  disabled?: boolean
  disabledHint?: string
  shortcut?: string
  variant?: 'flat' | 'accent' | 'footer'
  trailing?: ReactNode
  active?: boolean
  showChevron?: boolean
}

export function SidebarCommandRow({
  icon,
  label,
  onClick,
  disabled,
  disabledHint,
  shortcut,
  variant = 'flat',
  trailing,
  active = false,
  showChevron = false
}: SidebarCommandRowProps): ReactElement {
  const accent = variant === 'accent'
  const footer = variant === 'footer'
  return (
    <button
      type="button"
      data-cursor-spotlight-target
      data-active={active ? 'true' : 'false'}
      data-variant={variant}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={cx(
        'ds-sidebar-command-row flex min-h-9 w-full items-center gap-2.5 rounded-full border px-3 py-1.5 text-[13px] font-normal transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
        disabled
          ? 'cursor-not-allowed border-transparent text-ds-faint opacity-55'
          : active
            ? 'border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-row-active)] font-medium text-ds-ink'
            : footer
              ? 'border-transparent text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'
              : accent
                ? 'border-transparent text-ds-ink hover:bg-[var(--ds-sidebar-row-hover)]'
                : 'border-transparent text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'
      )}
    >
      <span
        className={cx(
          'flex h-5 w-5 shrink-0 items-center justify-center',
          accent ? 'text-ds-ink' : footer ? 'text-ds-faint' : 'text-ds-muted'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {shortcut ? (
        <kbd className="ds-kbd hidden items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-ds-faint sm:inline-flex">
          <Command className="h-2.5 w-2.5" strokeWidth={2} />
          {shortcut.replace('⌘', '')}
        </kbd>
      ) : null}
      {trailing ?? null}
      {showChevron ? <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} /> : null}
    </button>
  )
}

type SidebarSectionHeaderProps = {
  label: string
  title?: string
  actions?: ReactNode
}

export function SidebarSectionHeader({
  label,
  title,
  actions
}: SidebarSectionHeaderProps): ReactElement {
  return (
    <div className="ds-sidebar-section-header flex items-center justify-between px-3 pb-2 pt-5">
      <span
        className="min-w-0 truncate text-[11px] font-medium tracking-[0.02em] text-ds-faint"
        title={title}
      >
        {label}
      </span>
      {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  )
}

type SidebarIconButtonProps = {
  title: string
  children: ReactNode
  onClick?: () => void
  ariaLabel?: string
  disabled?: boolean
  active?: boolean
  tone?: 'default' | 'accent' | 'danger'
  className?: string
  stopPropagation?: boolean
}

export function SidebarIconButton({
  title,
  children,
  onClick,
  ariaLabel,
  disabled,
  active,
  tone = 'default',
  className,
  stopPropagation = false
}: SidebarIconButtonProps): ReactElement {
  const toneClass =
    tone === 'danger'
      ? 'hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300'
      : tone === 'accent'
        ? 'hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'
        : 'hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'

  return (
    <button
      type="button"
      data-cursor-spotlight-target
      disabled={disabled}
      onPointerDown={(event) => {
        if (stopPropagation) event.stopPropagation()
      }}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation()
        onClick?.()
      }}
      className={cx(
        'ds-sidebar-icon-button ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--ds-radius-control)] border border-transparent text-ds-faint transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-row-active)] text-ds-ink' : toneClass,
        className
      )}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

type SidebarSearchFieldProps = {
  value: string
  placeholder: string
  clearLabel: string
  onChange: (value: string) => void
}

export function SidebarSearchField({
  value,
  placeholder,
  clearLabel,
  onChange
}: SidebarSearchFieldProps): ReactElement {
  return (
    <label
      data-cursor-spotlight-target
      className="ds-sidebar-search-field relative min-w-0 flex-1 rounded-full"
    >
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
        strokeWidth={1.8}
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-full border border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-field-bg)] pl-8 pr-8 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/55 focus:bg-[var(--ds-sidebar-field-focus)] focus:ring-2 focus:ring-accent/15"
      />
      {value.trim() ? (
        <button
          type="button"
          data-cursor-spotlight-target
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
          title={clearLabel}
          aria-label={clearLabel}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      ) : null}
    </label>
  )
}

type SidebarTreeRowProps = {
  children: ReactNode
  onClick?: () => void
  title?: string
  ariaLabel?: string
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onDoubleClick?: () => void
  onMouseEnter?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onMouseMove?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (event: ReactMouseEvent<HTMLDivElement>) => void
  onFocusCapture?: () => void
  onBlurCapture?: () => void
  draggable?: boolean
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
  disabled?: boolean
  active?: boolean
  activeVariant?: 'rail' | 'outline'
  trailing?: ReactNode
  actions?: ReactNode
  actionsVisibility?: 'hidden' | 'subtle' | 'visible'
  actionsLayout?: 'inline' | 'overlay'
  className?: string
  buttonClassName?: string
  buttonStyle?: CSSProperties
}

export function SidebarTreeRow({
  children,
  onClick,
  title,
  ariaLabel,
  onContextMenu,
  onDoubleClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onFocusCapture,
  onBlurCapture,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  disabled,
  active = false,
  activeVariant = 'rail',
  trailing,
  actions,
  actionsVisibility = 'subtle',
  actionsLayout = 'inline',
  className,
  buttonClassName,
  buttonStyle
}: SidebarTreeRowProps): ReactElement {
  const outlined = active && activeVariant === 'outline'
  const rail = activeVariant === 'rail'
  const actionsClass =
    actionsVisibility === 'hidden'
      ? 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
      : actionsVisibility === 'visible'
        ? 'opacity-100'
        : 'opacity-55 group-hover:opacity-100 focus-within:opacity-100'
  const actionsWrapClass =
    actionsLayout === 'overlay'
      ? 'absolute inset-y-0 right-1.5 flex items-center gap-0.5'
      : 'mr-1.5 flex shrink-0 items-center gap-0.5'
  const trailingWrapClass =
    actionsLayout === 'overlay'
      ? 'mr-1.5 flex shrink-0 items-center gap-0.5 transition group-hover:opacity-0 group-focus-within:opacity-0'
      : 'flex shrink-0 items-center gap-0.5'

  return (
    <div
      data-cursor-spotlight-target
      data-active={active ? 'true' : 'false'}
      data-active-variant={activeVariant}
      className={cx(
        'ds-sidebar-tree-row group relative flex w-full items-center overflow-hidden rounded-[var(--ds-radius-control)] border text-[13px] font-normal transition',
        outlined
          ? 'border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-row-active)] text-ds-ink'
          : active
            ? 'border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-row-active)] text-ds-ink'
            : 'border-transparent text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink',
        className
      )}
      title={title}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {rail ? (
        <span
          aria-hidden
          className={cx(
            'absolute bottom-1 left-0 top-1 w-[2px] rounded-full transition',
            active ? 'bg-transparent opacity-0' : 'bg-transparent opacity-0'
          )}
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cx(
          'flex min-w-0 flex-1 text-left disabled:cursor-not-allowed',
          buttonClassName ?? 'items-center gap-2 px-2.5 py-2'
        )}
        style={buttonStyle}
      >
        {children}
      </button>
      {trailing ? <div className={trailingWrapClass}>{trailing}</div> : null}
      {actions ? (
        <div className={actionsWrapClass}>
          <div className={cx('flex shrink-0 items-center gap-0.5 transition', actionsClass)}>
            {actions}
          </div>
        </div>
      ) : null}
    </div>
  )
}
