import type { ReactElement, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import type { AgentCardModel } from './agent-center-actions'

/**
 * Shared Agent Center chrome: status dots, badges, the detail header, and the
 * first-load skeleton, so the list and the detail pane speak one visual language.
 */

export type AgentStatusTone = 'success' | 'warning' | 'muted' | 'running'

export function agentStatusTone(state: AgentCardModel['state']): AgentStatusTone {
  if (state === 'ready') return 'success'
  if (state === 'unavailable') return 'warning'
  if (state === 'detecting') return 'running'
  return 'muted'
}

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

export function AgentDetailHeader({ harnessId, name, badges, tone, status, meta }: {
  harnessId: string
  name: string
  badges?: ReactNode
  tone: AgentStatusTone
  status: ReactNode
  /** Secondary chips under the status line, e.g. supported credential modes. */
  meta?: ReactNode
}): ReactElement {
  return (
    <header className="flex min-w-0 items-start gap-3.5" data-agent-detail-header>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-ds-border-muted bg-ds-subtle text-ds-ink">
        <AgentIcon harnessId={harnessId} size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h3 className="min-w-0 break-words text-[15px] font-semibold leading-6 text-ds-ink">{name}</h3>
          {badges}
        </div>
        <p role="status" aria-live="polite" className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-5 text-ds-muted">
          <AgentStatusDot tone={tone} />
          <span className="min-w-0 break-words">{status}</span>
        </p>
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-1">{meta}</div> : null}
      </div>
    </header>
  )
}

/** First-load placeholder; background refreshes keep the real rows instead. */
export function AgentCatalogSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-agent-catalog-skeleton
      className="grid min-w-0 md:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex flex-col gap-1 border-b border-ds-border-muted bg-ds-subtle p-2 md:border-b-0 md:border-r">
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
