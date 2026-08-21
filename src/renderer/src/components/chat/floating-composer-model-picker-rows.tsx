import type { ReactElement } from 'react'
import { Check, ChevronRight, Image as ImageIcon, Type as TypeIcon } from 'lucide-react'

export function MenuSectionTitle({
  children,
  icon
}: {
  children: string
  icon: ReactElement
}): ReactElement {
  return (
    <div className="flex h-8 items-center gap-2 px-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ds-faint">
      {icon}
      <span>{children}</span>
    </div>
  )
}

export function MenuSeparator(): ReactElement {
  return <div className="my-2 h-px bg-ds-border-muted" />
}

export function PickerRow({
  selected,
  disabled = false,
  title,
  rightSlot,
  onClick
}: {
  selected: boolean
  disabled?: boolean
  title: string
  rightSlot?: ReactElement | null
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      title={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        disabled
          ? 'cursor-not-allowed text-ds-faint opacity-55'
          : selected
          ? 'bg-ds-hover text-ds-ink'
          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
      </span>
      {rightSlot}
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
    </button>
  )
}

export function ModelCapabilityBadge({
  kind,
  label
}: {
  kind: 'vision' | 'text'
  label: string
}): ReactElement {
  const tone = kind === 'vision'
    ? 'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-ds-border bg-ds-hover text-ds-muted'
  const Icon = kind === 'vision' ? ImageIcon : TypeIcon
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-semibold leading-none ${tone}`}
      title={label}
    >
      <Icon className="h-3 w-3" strokeWidth={1.9} />
      <span>{label}</span>
    </span>
  )
}

export function ProviderRow({
  active,
  selected,
  icon,
  title,
  subtitle,
  refNode,
  onClick,
  onMouseEnter
}: {
  active: boolean
  selected: boolean
  icon?: ReactElement | null
  title: string
  subtitle: string
  refNode: (node: HTMLButtonElement | null) => void
  onClick: () => void
  onMouseEnter: () => void
}): ReactElement {
  return (
    <SubmenuRow
      refNode={refNode}
      active={active}
      selected={selected}
      icon={icon}
      title={title}
      subtitle={subtitle}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    />
  )
}

export function SubmenuRow({
  active,
  selected,
  icon,
  title,
  subtitle,
  refNode,
  onClick,
  onMouseEnter
}: {
  active: boolean
  selected: boolean
  icon?: ReactElement | null
  title: string
  subtitle: string
  refNode: (node: HTMLButtonElement | null) => void
  onClick: () => void
  onMouseEnter: () => void
}): ReactElement {
  return (
    <button
      ref={refNode}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={active}
      title={subtitle ? `${title} / ${subtitle}` : title}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      onFocus={onMouseEnter}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        active
          ? 'bg-ds-hover text-ds-ink'
          : selected
            ? 'text-ds-ink hover:bg-ds-hover'
            : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[11.5px] font-medium text-ds-faint">{subtitle}</span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
    </button>
  )
}
