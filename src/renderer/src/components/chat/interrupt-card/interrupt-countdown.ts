import { useEffect, useState } from 'react'

/** Seconds before the deadline at which the countdown chip appears. */
export const INTERRUPT_COUNTDOWN_WINDOW_SECONDS = 60

export type InterruptCountdownState =
  | { kind: 'hidden' }
  | { kind: 'counting'; seconds: number }
  | { kind: 'deciding' }

/**
 * Deadline (epoch ms) of a request that carries `createdAt` + `timeoutSeconds`
 * (user_input blocks do); null when either is missing or invalid.
 */
export function interruptDeadlineMs(
  createdAt: string | number | null | undefined,
  timeoutSeconds: number | null | undefined
): number | null {
  if (createdAt == null || createdAt === '' || timeoutSeconds == null) return null
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return null
  const start = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt)
  return Number.isFinite(start) ? start + timeoutSeconds * 1000 : null
}

/**
 * Hidden until the last `windowSeconds`, then a whole-second countdown, then
 * "deciding" once the deadline has passed (the runtime resolves on its own).
 */
export function interruptCountdownState(
  deadlineMs: number | null | undefined,
  nowMs: number,
  windowSeconds = INTERRUPT_COUNTDOWN_WINDOW_SECONDS
): InterruptCountdownState {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return { kind: 'hidden' }
  const remaining = Math.ceil((deadlineMs - nowMs) / 1000)
  if (remaining <= 0) return { kind: 'deciding' }
  if (remaining > windowSeconds) return { kind: 'hidden' }
  return { kind: 'counting', seconds: remaining }
}

/**
 * Live countdown state. While far from the deadline it sleeps until the
 * window opens; inside the window it ticks once per second; after the
 * deadline it stops ticking.
 */
export function useInterruptCountdown(
  deadlineMs: number | null | undefined,
  windowSeconds = INTERRUPT_COUNTDOWN_WINDOW_SECONDS
): InterruptCountdownState {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const state = interruptCountdownState(deadlineMs, nowMs, windowSeconds)
  const finished = state.kind === 'deciding'
  const counting = state.kind === 'counting'
  useEffect(() => {
    if (deadlineMs == null || !Number.isFinite(deadlineMs) || finished) return
    if (typeof window === 'undefined') return
    if (!counting) {
      const untilWindow = Math.max(0, deadlineMs - windowSeconds * 1000 - Date.now())
      const timer = window.setTimeout(() => setNowMs(Date.now()), untilWindow + 50)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [counting, deadlineMs, finished, windowSeconds])
  return state
}
