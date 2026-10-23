import type { ReactElement, ReactNode } from 'react'

/** Shared look for the canvas inspector's Tweaks tab: label/control rows on a quiet surface. */
export const TWEAKS_FIELD =
  'h-8 w-full rounded-[8px] border border-ds-border bg-ds-main text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint hover:border-ds-border-strong focus:border-accent focus:ring-2 focus:ring-accent-tint/25 dark:border-white/10'
export const TWEAKS_BUTTON_PRIMARY =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-accent px-3 text-[12.5px] font-medium text-accent-foreground shadow-[0_1px_2px_rgba(15,23,42,0.14)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45'
export const TWEAKS_BUTTON_SECONDARY =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main px-3 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10'
export const TWEAKS_ICON_BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45'

export function TweaksSection({
  title,
  actions,
  children
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="min-w-0">
      <div className="mb-2.5 flex h-7 items-center justify-between gap-2">
        <h3 className="select-none text-[12.5px] font-semibold text-ds-ink">{title}</h3>
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/** One setting: a fixed label column and a control that fills the rest. */
export function TweaksRow({
  label,
  children,
  alignTop = false
}: {
  label: string
  children: ReactNode
  alignTop?: boolean
}): ReactElement {
  return (
    <div className={`grid grid-cols-[96px_minmax(0,1fr)] gap-3 ${alignTop ? 'items-start' : 'items-center'}`}>
      <span className={`select-none text-[12.5px] text-ds-muted ${alignTop ? 'pt-1.5' : ''}`}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function TweaksSegmented<T extends string>({
  value,
  options,
  ariaLabel,
  onChange
}: {
  value: T | undefined
  options: readonly { value: T; label: string; icon?: ReactNode }[]
  ariaLabel: string
  onChange: (value: T) => void
}): ReactElement {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex w-full items-center gap-0.5 rounded-[10px] bg-ds-hover p-[3px]">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12px] transition ${
              active
                ? 'bg-ds-elevated font-medium text-ds-ink shadow-[0_1px_2px_rgba(15,23,42,0.12)] dark:bg-white/[0.14]'
                : 'text-ds-muted hover:text-ds-ink'
            }`}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
