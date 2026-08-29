import { useEffect, useState } from 'react'
import { useChatStore } from '../../store/chat-store'
import type { ThreadGoal } from '../../agent/types'
import { formatGoalElapsedSeconds } from './floating-composer-policy'

/**
 * Resolve the anchor (ms epoch) for the in-progress turn's live elapsed time.
 *
 * The persisted `timeUsedSeconds` is only accumulated by the runtime when a
 * turn finishes, so the in-progress turn needs a live delta. That delta must
 * be anchored to the runtime's turn start time — not to when the composer
 * happened to mount — otherwise switching conversations, reloading the
 * window, or restarting the renderer resets the displayed time mid-turn.
 *
 * Precedence: the persisted turn record recovered on hydration/reconciliation
 * (also seeded live from the user_message event), then the live per-user
 * start observed in this session; `undefined` when no anchor is known.
 */
export function resolveGoalElapsedAnchorMs(input: {
  currentTurnStartedAtMs: number | null
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
}): number | undefined {
  if (input.currentTurnStartedAtMs != null) return input.currentTurnStartedAtMs
  if (!input.currentTurnUserId) return undefined
  return input.turnStartedAtByUserId[input.currentTurnUserId]
}

export function goalElapsedLabelAt(input: {
  goal: ThreadGoal | null
  timing: boolean
  anchorMs: number | undefined
  nowMs: number
}): string {
  const { goal, timing, anchorMs, nowMs } = input
  if (!goal) return ''
  const liveSeconds = timing && anchorMs != null
    ? Math.max(0, Math.floor((nowMs - anchorMs) / 1000))
    : 0
  return formatGoalElapsedSeconds((goal.timeUsedSeconds ?? 0) + liveSeconds)
}

/** Live elapsed-time label for the active thread goal banner. */
export function useGoalElapsedLabel(input: {
  busy: boolean
  goal: ThreadGoal | null
}): string {
  const { busy, goal } = input
  const currentTurnUserId = useChatStore((s) => s.currentTurnUserId)
  const currentTurnStartedAtMs = useChatStore((s) => s.currentTurnStartedAtMs)
  const turnStartedAtByUserId = useChatStore((s) => s.turnStartedAtByUserId)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const timing = busy && goal?.status === 'active'
  useEffect(() => {
    if (!timing) {
      setNowMs(Date.now())
      return
    }
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [timing, goal?.createdAt, goal?.objective, goal?.status])

  const anchorMs = timing
    ? resolveGoalElapsedAnchorMs({ currentTurnStartedAtMs, currentTurnUserId, turnStartedAtByUserId })
    : undefined
  return goalElapsedLabelAt({ goal, timing, anchorMs, nowMs })
}
