import type { ReactElement, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { AgentTone } from './agent-center-presentation'

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
