import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactElement,
  ReactNode
} from 'react'
import { useId } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TrayKind, TrayTone } from './tray-kind'
import './composer-tray.css'

/*
 * Shared building blocks for tray segments and sheets. Kinds compose these
 * instead of styling their own chrome, so every sheet reads as one surface.
 * Colors come from composer-tray.css tokens; never use `/NN` opacity on bare
 * `var()` Tailwind colors here (they are silently dropped).
 */

// ---------------------------------------------------------------------------
// Segment
// ---------------------------------------------------------------------------

/**
 * The bar's clickable chip. Owned by the container: kinds never render it,
 * they only provide `renderSegment` content. Wrapped in a span carrying
 * `data-composer-stack-item` so `[data-composer-stack-item="todo"] button`
 * keeps resolving to the segment for smoke scripts.
 */
export function TraySegmentButton({
  kind,
  open,
  compact,
  controlsId,
  onClick
}: {
  kind: TrayKind
  open: boolean
  compact: boolean
  controlsId?: string
  onClick: () => void
}): ReactElement {
  const expandable = kind.renderSheet !== null
  return (
    <span className="ds-composer-tray-segment-slot" data-composer-stack-item={kind.marker ?? kind.id}>
      <button
        {...kind.segmentAttributes}
        type="button"
        className="ds-composer-tray-segment ds-no-drag"
        data-tray-kind={kind.id}
        data-open={open ? 'true' : undefined}
        data-tone={kind.tone}
        aria-label={kind.ariaLabel}
        title={compact ? kind.ariaLabel : kind.title}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable && open ? controlsId : undefined}
        onClick={onClick}
      >
        {kind.renderSegment({ open, compact })}
      </button>
    </span>
  )
}

/**
 * Standard segment content: icon · label · tabular count. In compact mode the
 * label is dropped (the container shows `ariaLabel` as the tooltip).
 * `tone` waiting/error colors the label (e.g. "1 个等你处理").
 */
export function TraySegmentContent({
  icon,
  label,
  count,
  tone,
  compact = false,
  trailing
}: {
  icon?: ReactNode
  label?: ReactNode
  count?: ReactNode
  tone?: TrayTone
  compact?: boolean
  trailing?: ReactNode
}): ReactElement {
  return (
    <>
      {icon ? <span className="ds-composer-tray-segment-icon" aria-hidden="true">{icon}</span> : null}
      {!compact && label != null && label !== '' ? (
        <span className="ds-composer-tray-segment-label" data-tone={tone}>{label}</span>
      ) : null}
      {count != null && count !== '' ? <span className="ds-composer-tray-count">{count}</span> : null}
      {trailing}
    </>
  )
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

/**
 * Sheet header row: bold title, faint summary, trailing actions and a
 * collapse chevron (wired to the `close` the container passes to renderSheet).
 */
export function TraySheetHeader({
  title,
  summary,
  actions,
  onCollapse,
  collapseLabel
}: {
  title: ReactNode
  summary?: ReactNode
  actions?: ReactNode
  onCollapse?: () => void
  collapseLabel?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const label = collapseLabel ?? t('composerTray.collapse')
  return (
    <div className="ds-composer-tray-sheet-header">
      <span className="ds-composer-tray-sheet-title">{title}</span>
      {summary != null && summary !== '' ? (
        <span className="ds-composer-tray-sheet-summary">{summary}</span>
      ) : null}
      <span className="ds-composer-tray-sheet-actions">
        {actions}
        {onCollapse ? (
          <TrayIconButton label={label} onClick={onCollapse}>
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </TrayIconButton>
        ) : null}
      </span>
    </div>
  )
}

/** Vertical list of rows / fold rows under a sheet header. */
export function TraySheetBody({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div {...rest} className={`ds-composer-tray-sheet-body ${className ?? ''}`.trim()}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type TrayRowProps = Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> & {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /**
   * Content under the row's line (an output tail, details), on the same
   * surface: with `highlighted` the row and its detail form one raised card.
   * TrayRow has no `children`; use this slot.
   */
  detail?: ReactNode
  /** Live controls (buttons, pills). They stay clickable above the open target. */
  trailing?: ReactNode
  /** Makes the whole row an open target (a sibling button under the content). */
  onOpen?: () => void
  /** Accessible name of the open target; defaults to `title` when it is a string. */
  openLabel?: string
  /** Raised white row (current step, item needing the user). */
  highlighted?: boolean
  /** Monospace title (commands, paths). */
  monoTitle?: boolean
}

/**
 * Sheet row: leading · title / subtitle · trailing. With `onOpen` the row
 * gets a full-size open button placed *under* the content (no nested
 * buttons): leading and body pass clicks through to it, trailing controls
 * keep their own clicks. A subtitle makes it a 52px two-line row. `detail`
 * renders below the line inside a shared group surface (the open target
 * covers only the line, so detail text stays selectable); extra props then
 * land on the group.
 */
export function TrayRow({
  leading,
  title,
  subtitle,
  detail,
  trailing,
  onOpen,
  openLabel,
  highlighted = false,
  monoTitle = false,
  className,
  ...rest
}: TrayRowProps): ReactElement {
  const titleId = useId()
  const label = openLabel ?? (typeof title === 'string' ? title : undefined)
  const twoLine = subtitle != null && subtitle !== ''
  const hasDetail = detail != null && detail !== false && detail !== ''
  const line = (
    <div
      {...(hasDetail ? {} : rest)}
      className={`ds-composer-tray-row ${hasDetail ? '' : className ?? ''}`.trim()}
      data-two-line={twoLine ? 'true' : undefined}
      data-interactive={onOpen ? 'true' : undefined}
      data-highlighted={highlighted && !hasDetail ? 'true' : undefined}
    >
      {onOpen ? (
        <button
          type="button"
          className="ds-composer-tray-row-open ds-no-drag"
          aria-label={label}
          aria-labelledby={label ? undefined : titleId}
          onClick={onOpen}
        />
      ) : null}
      {leading ? <span className="ds-composer-tray-row-leading">{leading}</span> : null}
      <span className="ds-composer-tray-row-body">
        <span id={titleId} className={`ds-composer-tray-row-title ${monoTitle ? 'font-mono' : ''}`.trim()}>
          {title}
        </span>
        {twoLine ? <span className="ds-composer-tray-row-subtitle">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="ds-composer-tray-row-trailing">{trailing}</span> : null}
    </div>
  )
  if (!hasDetail) return line
  return (
    <div
      {...rest}
      className={`ds-composer-tray-row-group ${className ?? ''}`.trim()}
      data-highlighted={highlighted ? 'true' : undefined}
    >
      {line}
      <div className="ds-composer-tray-row-detail">{detail}</div>
    </div>
  )
}

/**
 * Disclosure row for folded groups ("已完成 3 项" / "待处理 7 项").
 * Chevron points up while expanded, down while folded.
 */
export function TrayFoldRow({
  expanded,
  onToggle,
  label,
  trailing,
  controls
}: {
  expanded: boolean
  onToggle: () => void
  label: ReactNode
  /** Non-interactive extras (status pill, count). Rendered inside the button. */
  trailing?: ReactNode
  /** id of the element the fold shows/hides. */
  controls?: string
}): ReactElement {
  const Icon = expanded ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      className="ds-composer-tray-fold ds-no-drag"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
      {trailing ? <span className="ds-composer-tray-fold-trailing">{trailing}</span> : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Soft rounded pill: 等你处理 / 已完成 / 失败 / 进行中. */
export function TrayStatusPill({
  tone = 'default',
  icon,
  children,
  className
}: {
  tone?: TrayTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}): ReactElement {
  return (
    <span className={`ds-composer-tray-pill ${className ?? ''}`.trim()} data-tone={tone}>
      {icon}
      {children}
    </span>
  )
}

/** 6px status dot (live server, failed command). Decorative unless labelled. */
export function TrayDot({ tone = 'default', label }: { tone?: TrayTone; label?: string }): ReactElement {
  return (
    <span
      className="ds-composer-tray-dot"
      data-tone={tone}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}

/**
 * Small circular progress (14px default). `value` is 0..1; `indeterminate`
 * spins a quarter arc instead (stops under reduced motion).
 */
export function TrayProgressRing({
  value = 0,
  size = 14,
  tone = 'running',
  indeterminate = false,
  label
}: {
  value?: number
  size?: number
  tone?: TrayTone
  indeterminate?: boolean
  label?: string
}): ReactElement {
  const radius = 6
  const circumference = 2 * Math.PI * radius
  const ratio = indeterminate ? 0.25 : Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const arc = circumference * ratio
  return (
    <svg
      className="ds-composer-tray-ring"
      data-tone={tone}
      data-indeterminate={indeterminate ? 'true' : undefined}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle className="ds-composer-tray-ring-track" cx="8" cy="8" r={radius} fill="none" strokeWidth="2.2" />
      {arc > 0 ? (
        <circle
          className="ds-composer-tray-ring-arc"
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray={`${arc.toFixed(2)} ${circumference.toFixed(2)}`}
          transform="rotate(-90 8 8)"
        />
      ) : null}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type TrayButtonVariant = 'ghost' | 'outline' | 'solid'

/** Text button for sheet actions (在协作面板打开 ↗, 去回答, 复制输出, 发给 Kun). */
export function TrayButton({
  variant = 'ghost',
  icon,
  trailingIcon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: TrayButtonVariant
  icon?: ReactNode
  trailingIcon?: ReactNode
}): ReactElement {
  return (
    <button
      {...rest}
      type={type}
      className={`ds-composer-tray-button ds-no-drag ${className ?? ''}`.trim()}
      data-variant={variant}
    >
      {icon}
      {children}
      {trailingIcon}
    </button>
  )
}

/** 26px icon-only button; `label` becomes aria-label and tooltip. */
export function TrayIconButton({
  label,
  children,
  className,
  type = 'button',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string
}): ReactElement {
  return (
    <button
      {...rest}
      type={type}
      className={`ds-composer-tray-icon-button ds-no-drag ${className ?? ''}`.trim()}
      aria-label={label}
      title={rest.title ?? label}
    >
      {children}
    </button>
  )
}

/**
 * Ghost stop control with a filled square ("■ 停止"). `iconOnly` keeps the
 * square and moves the label into aria-label / tooltip.
 */
export function TrayStopButton({
  onClick,
  label,
  iconOnly = false,
  disabled = false
}: {
  onClick: () => void
  label?: string
  iconOnly?: boolean
  disabled?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const text = label ?? t('composerTray.stop')
  return (
    <button
      type="button"
      className="ds-composer-tray-stop ds-no-drag"
      disabled={disabled}
      aria-label={iconOnly ? text : undefined}
      title={iconOnly ? text : undefined}
      onClick={onClick}
    >
      <span className="ds-composer-tray-stop-square" aria-hidden="true" />
      {iconOnly ? null : <span>{text}</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * Rounded-square agent avatar: one or two glyphs on a solid color, or an
 * icon. `round` makes it a circle (a Collaboration member's seat). Decorative
 * by default; pass `title` to expose a name.
 */
export function TrayAvatar({
  label,
  color,
  size = 'sm',
  round = false,
  title,
  icon
}: {
  label?: string
  color?: string
  size?: 'sm' | 'lg'
  round?: boolean
  title?: string
  icon?: ReactNode
}): ReactElement {
  const style: CSSProperties | undefined = color ? { background: color } : undefined
  const glyph = label ? Array.from(label.trim()).slice(0, 2).join('') : ''
  return (
    <span
      className="ds-composer-tray-avatar"
      data-size={size}
      data-round={round ? '' : undefined}
      style={style}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {icon ?? glyph}
    </span>
  )
}

/** Overlapping avatars; extra ones beyond `max` are dropped (callers add "+n"). */
export function TrayAvatarStack({
  children,
  max
}: {
  children: ReactNode[]
  max?: number
}): ReactElement {
  const shown = max === undefined ? children : children.slice(0, Math.max(0, max))
  return <span className="ds-composer-tray-avatar-stack">{shown}</span>
}
