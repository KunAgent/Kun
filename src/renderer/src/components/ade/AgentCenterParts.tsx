import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { AgentTone } from './agent-center-presentation'
import { formatAgentUpdateElapsed } from './AgentUpdateProgress'

/**
 * Shared Agent Center chrome: status dots, badges and the first-load skeleton,
 * so the list and the detail pane speak one visual language.
 */

export type AgentStatusTone = AgentTone

const DOT_CLASS: Record<Exclude<AgentStatusTone, 'running'>, string> = {
  success: 'bg-ds-status-dot-success',
  warning: 'bg-ds-status-dot-warning',
  muted: 'bg-ds-status-dot-muted'
}

export function AgentStatusDot({ tone, className = '' }: { tone: AgentStatusTone; className?: string }): ReactElement {
  if (tone === 'running') {
    return <Loader2 aria-hidden data-agent-status-tone={tone} className={`h-3 w-3 shrink-0 animate-spin text-ds-status-running ${className}`} />
  }
  return <span aria-hidden data-agent-status-tone={tone} className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]} ${className}`} />
}

const BADGE_CLASS = {
  neutral: 'border border-ds-border-muted text-ds-muted',
  accent: 'bg-accent-tint/10 text-accent',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
} as const

export function AgentBadge({ children, tone = 'neutral', mono = false }: {
  children: ReactNode
  tone?: keyof typeof BADGE_CLASS
  mono?: boolean
}): ReactElement {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium leading-[18px] ${mono ? 'font-mono' : ''} ${BADGE_CLASS[tone]}`}>
      {children}
    </span>
  )
}

/** First-load placeholder; background refreshes keep the real rows instead. */
export function AgentCatalogSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-agent-catalog-skeleton
      className="grid min-w-0 lg:grid-cols-[300px_minmax(0,1fr)]">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex flex-col gap-1 border-b border-ds-border-muted bg-ds-subtle p-2 lg:border-b-0 lg:border-r">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-ds-hover" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-24 animate-pulse rounded bg-ds-hover" />
              <div className="mt-1.5 h-2.5 w-14 animate-pulse rounded bg-ds-hover" />
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden className="min-w-0 space-y-4 p-5">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 animate-pulse rounded-xl bg-ds-hover" />
          <div className="space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-ds-hover" />
            <div className="h-3 w-24 animate-pulse rounded bg-ds-hover" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-ds-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{label}</span>
        </div>
        <div className="h-24 animate-pulse rounded-xl bg-ds-hover" />
      </div>
    </div>
  )
}

/** Time since `since`, ticking once a second; used wherever work in flight is reported. */
export function AgentElapsed({ since, className = '' }: { since: number; className?: string }): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return <span data-agent-elapsed className={`font-mono tabular-nums ${className}`}>{formatAgentUpdateElapsed(now - since)}</span>
}

/**
 * One block of an Agent page: a heading row and one bordered group of rows.
 * This is the only box inside the workspace.
 */
export function AgentSection({ title, description, action, children, bare = false, ...data }: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  /** Content draws its own surface (e.g. a code block). */
  bare?: boolean
} & Record<`data-${string}`, string | boolean | undefined>): ReactElement {
  return <section className="min-w-0 space-y-2.5" {...data}>
    {title || action ? <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {title ? <h3 className="text-[13.5px] font-semibold leading-5 text-ds-ink">{title}</h3> : null}
        {description ? <p className="mt-0.5 text-[12px] leading-[1.5] text-ds-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div> : null}
    {bare ? children : <div className="ds-agent-group min-w-0 divide-y divide-ds-border-muted overflow-hidden rounded-xl border border-ds-border-muted bg-ds-card px-1">{children}</div>}
  </section>
}

export type AgentTabItem<T extends string> = { id: T; label: string; count?: number; dot?: 'accent' | 'warning'; dotLabel?: string }

/**
 * Underline tabs that span the detail column; ids match `SettingsTabPanel`
 * (`<baseId>-tab-<id>` / `<baseId>-panel-<id>`).
 */
export function AgentTabs<T extends string>({ baseId, ariaLabel, items, value, onChange }: {
  baseId: string
  ariaLabel: string
  items: Array<AgentTabItem<T>>
  value: T
  onChange: (id: T) => void
}): ReactElement {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
    if (next === null) return
    event.preventDefault()
    onChange(items[next]!.id)
    refs.current[next]?.focus()
  }
  return <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" data-agent-tabs
    className="flex min-w-0 items-end gap-6 overflow-x-auto border-b border-ds-border-muted">
    {items.map((item, index) => {
      const active = item.id === value
      return <button key={item.id} ref={(node) => { refs.current[index] = node }} type="button" role="tab"
        id={`${baseId}-tab-${item.id}`} aria-selected={active} aria-controls={`${baseId}-panel-${item.id}`} tabIndex={active ? 0 : -1}
        onClick={() => onChange(item.id)} onKeyDown={(event) => keyDown(event, index)} data-agent-tab={item.id}
        className={`-mb-px flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-px text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-tint/40 ${active
          ? 'border-ds-ink font-semibold text-ds-ink' : 'border-transparent text-ds-muted hover:text-ds-ink'}`}>
        {item.label}
        {item.count ? <span className="text-[11px] font-normal tabular-nums text-ds-faint">{item.count}</span> : null}
        {item.dot ? <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${item.dot === 'warning' ? 'bg-[var(--ds-warning)]' : 'bg-accent'}`} /> : null}
        {item.dot && item.dotLabel ? <span className="sr-only">{item.dotLabel}</span> : null}
      </button>
    })}
  </div>
}
