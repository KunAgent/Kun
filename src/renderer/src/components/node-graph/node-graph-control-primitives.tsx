import { useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Toggle } from '../settings-controls'
import {
  nodeGraphSliderRange,
  type NodeGraphSliderKey
} from '../../node-graph/node-graph-settings'

/**
 * Shared controls for the graph rail.
 *
 * Sections collapse because the rail holds six of them: an always-expanded rail
 * makes every control a scroll away, which is what made the previous layout hard
 * to operate.
 */
export function ControlSection({
  title,
  defaultOpen = false,
  action,
  children
}: {
  title: string
  defaultOpen?: boolean
  action?: ReactNode
  children: ReactNode
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-ds-border-muted last:border-b-0">
      <div className="flex items-center gap-1 px-2.5 py-2">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open
            ? <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
            : <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />}
          <span className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-ds-faint">
            {title}
          </span>
        </button>
        {action}
      </div>
      {open ? <div className="flex flex-col gap-2 px-2.5 pb-3">{children}</div> : null}
    </section>
  )
}

export function SliderRow({
  label,
  value,
  settingKey,
  format,
  onChange
}: {
  label: string
  value: number
  settingKey: NodeGraphSliderKey
  format?: (value: number) => string
  onChange: (value: number) => void
}): ReactElement {
  const range = nodeGraphSliderRange(settingKey)
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-[11.5px] text-ds-muted">
        <span className="truncate">{label}</span>
        <span className="tabular-nums text-ds-faint">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-[var(--ds-accent)]"
      />
    </label>
  )
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  icon,
  count
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
  icon?: ReactNode
  count?: number
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        {icon ? <span className="shrink-0 text-ds-faint">{icon}</span> : null}
        <span className="min-w-0">
          <span className="block truncate text-[12px] text-ds-ink">
            {label}
            {typeof count === 'number' ? (
              <span className="ml-1 tabular-nums text-ds-faint">{count}</span>
            ) : null}
          </span>
          {hint ? <span className="block text-[10.5px] leading-4 text-ds-faint">{hint}</span> : null}
        </span>
      </span>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  )
}
