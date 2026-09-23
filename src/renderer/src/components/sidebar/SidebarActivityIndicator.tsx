import type { ReactElement } from 'react'
import { CircleAlert, CircleHelp, Loader2 } from 'lucide-react'

export type SidebarActivity = 'awaiting-input' | 'running' | 'failed' | 'unread' | 'idle'

type Props = {
  activity: SidebarActivity
  runningLabel: string
  failedLabel: string
  unreadLabel: string
  awaitingInputLabel: string
  className?: string
}

export function SidebarActivityIndicator({
  activity,
  runningLabel,
  failedLabel,
  unreadLabel,
  awaitingInputLabel,
  className = ''
}: Props): ReactElement | null {
  if (activity === 'awaiting-input') {
    return (
      <span className={`inline-flex ${className}`} title={awaitingInputLabel}>
        <CircleHelp
          className="h-3.5 w-3.5 shrink-0 text-amber-500 motion-safe:animate-pulse motion-reduce:animate-none"
          strokeWidth={2.2}
          role="img"
          aria-label={awaitingInputLabel}
        />
      </span>
    )
  }
  if (activity === 'running') {
    return (
      <Loader2
        className={`h-3.5 w-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none ${className}`}
        strokeWidth={2}
        role="img"
        aria-label={runningLabel}
      />
    )
  }
  if (activity === 'failed') {
    return (
      <span className={`inline-flex ${className}`} title={failedLabel}>
        <CircleAlert
          className="h-3.5 w-3.5 shrink-0 text-red-500"
          strokeWidth={2}
          role="img"
          aria-label={failedLabel}
        />
      </span>
    )
  }
  if (activity === 'unread') {
    return (
      <span
        className={`block h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_1px_rgba(79,124,255,0.2)] ${className}`}
        title={unreadLabel}
        role="img"
        aria-label={unreadLabel}
      />
    )
  }
  return null
}
