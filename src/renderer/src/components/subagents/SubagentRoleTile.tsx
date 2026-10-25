import type { CSSProperties, ReactElement } from 'react'
import {
  Bot,
  Code2,
  Compass,
  Eye,
  FlaskConical,
  ListChecks,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { BUILTIN_AGENT_CATALOG_BY_ID } from '../../../../../kun/src/delegation/builtin-agent-catalog'
import { isTerminalSubagentStatus, type SubagentLivenessStatus } from './SubagentLiveness'

const CATEGORY_ICON: Record<string, LucideIcon> = {
  research: Compass,
  review: Eye,
  quality: FlaskConical,
  development: Code2,
  planning: ListChecks,
  operations: Wrench
}

export type SubagentRoleVisual = { Icon: LucideIcon; color: string }

/**
 * Identity of a subagent role: the icon follows its catalog category and the
 * tint its catalog color. Roles outside the catalog (generated, workspace)
 * get a neutral icon and a color derived from their id so they stay distinct.
 */
export function subagentRoleVisual(profileId: string | undefined, hue: number | null = null): SubagentRoleVisual {
  const entry = profileId ? BUILTIN_AGENT_CATALOG_BY_ID[profileId] : undefined
  if (profileId === 'explore') return { Icon: Compass, color: entry?.color ?? '#1d9e75' }
  if (entry) return { Icon: CATEGORY_ICON[entry.category] ?? Bot, color: entry.color }
  return { Icon: Bot, color: hue === null ? '#64748b' : `hsl(${hue} 55% 42%)` }
}

const SIZES = {
  sm: { box: 'h-[26px] w-[26px] rounded-[8px]', icon: 14, ring: 34, dot: 'h-3 w-3' },
  md: { box: 'h-[30px] w-[30px] rounded-[9px]', icon: 16, ring: 38, dot: 'h-[13px] w-[13px]' },
  lg: { box: 'h-10 w-10 rounded-[12px]', icon: 20, ring: 48, dot: 'h-[15px] w-[15px]' }
} as const

export type SubagentRoleTileSize = keyof typeof SIZES

function StatusMark({ status, dot }: { status: SubagentLivenessStatus; dot: string }): ReactElement | null {
  const base = `absolute -bottom-[3px] -right-[3px] flex ${dot} items-center justify-center rounded-full border-2 border-ds-card`
  if (status === 'done') {
    return (
      <span className={`${base} bg-emerald-600 dark:bg-emerald-400`} data-mark="done">
        <svg viewBox="0 0 24 24" className="h-[60%] w-[60%] text-white dark:text-slate-900" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className={`${base} bg-red-600 text-[9px] font-extrabold leading-none text-white dark:bg-red-400 dark:text-slate-900`} data-mark="failed" aria-hidden="true">
        !
      </span>
    )
  }
  if (status === 'stopped') return <span className={`${base} bg-slate-500 dark:bg-slate-400`} data-mark="stopped" />
  return null
}

/**
 * Role-icon tile with the run status on its corner: a still rounded track with
 * a traveling highlight while running, an amber ring while waiting for approval,
 * a dashed outline while queued, and a check / ! / grey dot once it ended.
 */
export function SubagentRoleTile({
  profileId,
  status,
  size = 'md',
  hue = null,
  animate = true,
  neutral = false,
  children,
  className = ''
}: {
  profileId?: string
  status: SubagentLivenessStatus
  size?: SubagentRoleTileSize
  hue?: number | null
  animate?: boolean
  /** Untinted tile for another Agent's own logo. */
  neutral?: boolean
  /** Replaces the role icon, e.g. an external Agent's own logo. */
  children?: ReactElement
  className?: string
}): ReactElement {
  const dim = SIZES[size]
  const { Icon, color } = subagentRoleVisual(profileId, hue)
  const queued = status === 'queued'
  const stopped = status === 'stopped'
  const style: CSSProperties = queued || stopped || neutral
    ? {}
    : { backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }
  const outline = neutral && !queued && !stopped
    ? `border border-ds-border-muted bg-ds-card text-ds-ink ${status === 'awaiting-permission' ? 'ring-2 ring-amber-500' : ''}`
    : queued
    ? 'border border-dashed border-ds-border text-ds-faint'
    : stopped
      ? 'bg-ds-card-muted text-ds-muted'
      : status === 'awaiting-permission'
        ? 'ring-2 ring-amber-500'
        : ''
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center ${dim.box} ${outline} ${className}`}
      style={style}
      data-status={status}
    >
      {children ?? <Icon size={dim.icon} strokeWidth={2} aria-hidden="true" />}
      {status === 'running' ? (
        <svg
          className="pointer-events-none absolute -inset-1 text-accent"
          width={dim.ring}
          height={dim.ring}
          viewBox="0 0 38 38"
          fill="none"
          aria-hidden="true"
        >
          <rect x="1.5" y="1.5" width="35" height="35" rx="11.5" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.4" />
          <rect
            className={animate ? 'ds-subagent-ring-trail' : undefined}
            x="1.5" y="1.5" width="35" height="35" rx="11.5"
            pathLength="100" stroke="currentColor" strokeWidth="1.6"
            strokeDasharray="18 82" strokeLinecap="round"
          />
        </svg>
      ) : null}
      {!isTerminalSubagentStatus(status) ? null : <StatusMark status={status} dot={dim.dot} />}
    </span>
  )
}
