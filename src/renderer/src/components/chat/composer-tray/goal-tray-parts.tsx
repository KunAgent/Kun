import type { ComponentProps, ReactElement } from 'react'
import { Pause, Play, Target } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadGoal, ThreadGoalStatus } from '../../../agent/types'
import type { TrayTone } from './tray-kind'
import type { TrayTranslate } from './tray-elapsed'
import { TrayButton, TraySegmentContent } from './tray-primitives'
import { GoalElapsedText } from './goal-tray-elapsed'
import './goal-tray.css'

/*
 * Shared goal pieces: status tone / copy, the token formatter, the bar
 * segment, and the 28px action buttons used by both the tray sheet and the
 * "设为目标" popover (FloatingComposerGoalPanel). goal-tray.css keeps the
 * trailing segment from shrinking and the outlined toggle's focus ring.
 */

/**
 * - active: running (accent)
 * - blocked / usageLimited / budgetLimited: waiting (needs the user)
 * - complete: done
 * - paused: neutral
 */
export function goalTrayTone(status: ThreadGoalStatus): TrayTone {
  switch (status) {
    case 'active':
      return 'running'
    case 'complete':
      return 'done'
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return 'waiting'
    default:
      return 'default'
  }
}

/** Full status for pills and labels: 进行中 / 已暂停 / 已阻塞 / 用量受限 / 预算受限 / 已完成. */
export function goalStatusLabel(status: ThreadGoalStatus, t: TrayTranslate): string {
  switch (status) {
    case 'active':
      return t('composerTrayGoal.status.active')
    case 'paused':
      return t('composerTrayGoal.status.paused')
    case 'blocked':
      return t('composerTrayGoal.status.blocked')
    case 'usageLimited':
      return t('composerTrayGoal.status.usageLimited')
    case 'budgetLimited':
      return t('composerTrayGoal.status.budgetLimited')
    case 'complete':
      return t('composerTrayGoal.status.complete')
    default:
      return String(status)
  }
}

/**
 * Word shown in the bar after "目标" when the goal is not running: muted
 * "已暂停", otherwise the short status the old goal floater used.
 */
export function goalSegmentStatusLabel(status: ThreadGoalStatus, t: TrayTranslate): string | null {
  switch (status) {
    case 'active':
      return null
    case 'paused':
      return t('composerTrayGoal.status.paused')
    case 'blocked':
      return t('goalStatusShort.blocked')
    case 'usageLimited':
      return t('goalStatusShort.usageLimited')
    case 'budgetLimited':
      return t('goalStatusShort.budgetLimited')
    case 'complete':
      return t('goalStatusShort.complete')
    default:
      return String(status)
  }
}

function toneTextClass(tone: TrayTone): string {
  if (tone === 'waiting') return 'font-semibold text-ds-status-warning'
  if (tone === 'done') return 'text-ds-status-success'
  return ''
}

/** Compact token count: 860 · 1.5k · 142k · 2.4M. */
export function formatGoalTokens(value: number): string {
  const tokens = Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
  const scaled = (amount: number, suffix: string): string => {
    const text = amount < 10 ? amount.toFixed(1).replace(/\.0$/, '') : String(Math.round(amount))
    return `${text}${suffix}`
  }
  if (tokens < 1000) return String(tokens)
  if (tokens < 999_500) return scaled(tokens / 1000, 'k')
  if (tokens < 999_500_000) return scaled(tokens / 1_000_000, 'M')
  return scaled(tokens / 1_000_000_000, 'B')
}

/**
 * Bar segment: ◎ 目标 18 分钟 while active; ◎ 目标 已暂停 / 阻塞 / 完成
 * otherwise (warning / success tones). Compact: icon + elapsed only. The
 * slot keeps its full width in a crowded bar (goal-tray.css), so the short
 * label is never cut mid-glyph; the leading segments ellipsize instead.
 */
export function GoalTraySegment({
  goal,
  busy,
  compact
}: {
  goal: ThreadGoal
  busy: boolean
  compact: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const toneClass = toneTextClass(goalTrayTone(goal.status))
  const icon = <Target className={compact ? 'h-[13px] w-[13px]' : 'h-3.5 w-3.5'} strokeWidth={2} />
  if (compact) {
    return (
      <TraySegmentContent
        compact
        icon={icon}
        count={<GoalElapsedText goal={goal} busy={busy} compact className={toneClass} />}
      />
    )
  }
  const status = goalSegmentStatusLabel(goal.status, t)
  return (
    <TraySegmentContent
      icon={icon}
      label={t('composerTrayGoal.label')}
      count={status == null
        ? <GoalElapsedText goal={goal} busy={busy} />
        : <span className={toneClass} data-goal-status={goal.status}>{status}</span>}
    />
  )
}

export type GoalActionButtonProps = ComponentProps<typeof TrayButton> & {
  /** Danger text (清除); keeps its color on hover. */
  danger?: boolean
}

/** 28px / 13px text action in the goal sheet and popover. */
export function GoalActionButton({
  danger = false,
  className,
  variant = 'ghost',
  ...rest
}: GoalActionButtonProps): ReactElement {
  const dangerClass = danger ? '!text-ds-status-danger hover:!bg-ds-danger-soft' : ''
  return (
    <TrayButton
      {...rest}
      variant={variant}
      className={`ds-goal-tray-action !h-7 !px-2.5 !text-[13px] ${dangerClass} ${className ?? ''}`.trim()}
    />
  )
}

/** Outlined ⏸ 暂停 while active, ▶ 继续 for any other status (as the old floater did). */
export function GoalStatusToggleButton({
  status,
  onToggle
}: {
  status: ThreadGoalStatus
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const pausing = status === 'active'
  const Icon = pausing ? Pause : Play
  return (
    <GoalActionButton
      variant="outline"
      data-goal-action={pausing ? 'pause' : 'resume'}
      icon={<Icon className="h-3 w-3" fill="currentColor" strokeWidth={pausing ? 0 : 1.5} aria-hidden="true" />}
      onClick={onToggle}
    >
      {pausing ? t('goalActionPause') : t('goalActionResume')}
    </GoalActionButton>
  )
}
