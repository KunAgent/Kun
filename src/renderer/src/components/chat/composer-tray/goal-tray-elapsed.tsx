import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadGoal } from '../../../agent/types'
import { useChatStore } from '../../../store/chat-store'
import { resolveGoalElapsedAnchorMs } from '../use-goal-elapsed'
import { formatTrayDuration, useTrayNow, type TrayTranslate } from './tray-elapsed'

/*
 * Live goal clock for the tray segment and sheet. The persisted
 * `timeUsedSeconds` only grows when a turn settles, so while a turn runs on an
 * active goal the in-progress turn adds a live delta anchored to the
 * runtime's turn start (see resolveGoalElapsedAnchorMs). The clock lives in
 * the component that shows it, so only that label re-renders each second.
 */

/** Persisted goal time plus the live delta of the running turn (whole seconds). */
export function goalElapsedSecondsAt({
  goal,
  timing,
  anchorMs,
  nowMs
}: {
  goal: Pick<ThreadGoal, 'timeUsedSeconds'>
  timing: boolean
  anchorMs: number | undefined
  nowMs: number
}): number {
  const base = Number.isFinite(goal.timeUsedSeconds) ? Math.max(0, Math.floor(goal.timeUsedSeconds)) : 0
  const live = timing && anchorMs != null ? Math.max(0, Math.floor((nowMs - anchorMs) / 1000)) : 0
  return base + live
}

/**
 * Goal elapsed label. Under a minute it counts seconds ("42 秒") so a fresh
 * goal visibly ticks; after that it reads in minutes ("18 分钟" / "18 min").
 * Compact bars use the short form ("18 分" / "18m", "1 小时 5 分").
 */
export function formatGoalElapsed(totalSeconds: number, t: TrayTranslate, compact = false): string {
  const value = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0))
  if (value < 60) return formatTrayDuration(value, t, 'seconds')
  if (compact) return formatTrayDuration(value - (value % 60), t, 'seconds')
  return formatTrayDuration(value, t, 'minutes')
}

/** Whole seconds spent on the goal, ticking once per second while it is being worked on. */
export function useGoalElapsedSeconds(goal: ThreadGoal, busy: boolean): number {
  const timing = busy && goal.status === 'active'
  const anchorMs = useChatStore((state) => (timing
    ? resolveGoalElapsedAnchorMs({
        currentTurnStartedAtMs: state.currentTurnStartedAtMs,
        currentTurnUserId: state.currentTurnUserId,
        turnStartedAtByUserId: state.turnStartedAtByUserId
      })
    : undefined))
  const nowMs = useTrayNow(timing && anchorMs != null)
  return goalElapsedSecondsAt({ goal, timing, anchorMs, nowMs })
}

/** Tabular elapsed label that owns the goal clock. */
export function GoalElapsedText({
  goal,
  busy,
  compact = false,
  className
}: {
  goal: ThreadGoal
  busy: boolean
  compact?: boolean
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const seconds = useGoalElapsedSeconds(goal, busy)
  return (
    <span className={`tabular-nums ${className ?? ''}`.trim()}>
      {formatGoalElapsed(seconds, t, compact)}
    </span>
  )
}
