import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentDispatchAction,
  AgentDispatchAssignmentRoute,
  AgentDispatchIntentView,
  AgentDispatchRecommendationEdit
} from '@shared/agent-dispatch'
import { assignmentRoute, dispatchAssignments, replaceAssignmentRoute, sameAssignmentRoute } from './agent-dispatch-card-model'

/** Quiet time after the last touch before the card's no-response window starts again. */
export const DISPATCH_HOLD_IDLE_MS = 10_000

type Act = (action: AgentDispatchAction,
  changes?: { recommendation?: AgentDispatchRecommendationEdit }) => Promise<AgentDispatchIntentView | undefined>

/**
 * While the user works on a counting-down card, the countdown stops: the first
 * touch pauses the card, route picks stay local, and only after
 * DISPATCH_HOLD_IDLE_MS without another touch is one `update` (or `resume`)
 * sent, which starts a fresh no-response window.
 */
export function useDispatchInteractionHold(intent: AgentDispatchIntentView | undefined, act: Act,
  /** Outcome of the held picks' `update`, so a refusal is shown instead of silently reverting. */
  onUpdated?: (ok: boolean) => void) {
  const [routes, setRoutes] = useState<AgentDispatchAssignmentRoute[]>()
  const [resumeAt, setResumeAt] = useState<number>()
  const [now, setNow] = useState(() => Date.now())
  const routesRef = useRef(routes)
  const pausedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const intentRef = useRef(intent)
  intentRef.current = intent
  const actRef = useRef(act)
  actRef.current = act
  const onUpdatedRef = useRef(onUpdated)
  onUpdatedRef.current = onUpdated
  // Rows whose Agent pick still waits for a model catalog; the hold stays open for them.
  const pendingRef = useRef(new Set<number>())

  const setHeld = (next: AgentDispatchAssignmentRoute[] | undefined): void => {
    routesRef.current = next
    setRoutes(next)
  }
  const clearTimer = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = undefined
  }

  const flush = useCallback(async (): Promise<void> => {
    clearTimer()
    const held = routesRef.current
    const current = intentRef.current
    setHeld(undefined)
    setResumeAt(undefined)
    const paused = pausedRef.current
    pausedRef.current = false
    if (!held || !current) return
    const changed = held.some((route, index) => !sameAssignmentRoute(route, dispatchAssignments(current)[index]))
    if (changed && ['paused', 'countdown', 'pending_confirmation'].includes(current.state)) {
      const next = await actRef.current('update', { recommendation: { assignments: held } })
      onUpdatedRef.current?.(Boolean(next))
    } else if (paused && current.state === 'paused') {
      await actRef.current('resume')
    }
  }, [])
  const flushRef = useRef(flush)
  flushRef.current = flush

  const arm = (): void => {
    clearTimer()
    const at = Date.now() + DISPATCH_HOLD_IDLE_MS
    setResumeAt(at)
    setNow(Date.now())
    timerRef.current = setTimeout(() => {
      // A pick still loading its models is part of what the user is doing.
      if (pendingRef.current.size) arm()
      else void flushRef.current()
    }, DISPATCH_HOLD_IDLE_MS)
  }

  /** Any use of the card's route controls. Starts a hold only on a counting-down card. */
  const touch = useCallback((): void => {
    if (routesRef.current) { arm(); return }
    const current = intentRef.current
    if (!current || current.state !== 'countdown') return
    setHeld(dispatchAssignments(current).map(assignmentRoute))
    arm()
    void actRef.current('pause').then((next) => {
      if (next?.state === 'paused') { pausedRef.current = true; return }
      // Kun refused the pause (already started, cancelled): nothing to hold.
      clearTimer()
      setHeld(undefined)
      setResumeAt(undefined)
    })
  // arm/clearTimer only touch refs and setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Keep a route pick local while holding; returns false when there is no hold to keep it in. */
  const changeRoute = useCallback((index: number, route: AgentDispatchAssignmentRoute): boolean => {
    if (!routesRef.current) touch()
    const held = routesRef.current
    if (!held) return false
    setHeld(replaceAssignmentRoute(held, index, route))
    arm()
    return true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch])

  /** A row's Agent pick started or stopped waiting for its catalog. */
  const setPending = useCallback((index: number, pending: boolean): void => {
    const rows = pendingRef.current
    if (pending === rows.has(index)) return
    if (pending) rows.add(index)
    else rows.delete(index)
    if (routesRef.current) arm()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Hand the held routes to the full editor; the card stays paused until the user saves or resumes. */
  const release = useCallback((): AgentDispatchAssignmentRoute[] | undefined => {
    clearTimer()
    const held = routesRef.current
    pausedRef.current = false
    setHeld(undefined)
    setResumeAt(undefined)
    return held
  }, [])

  // The user resumed, started or cancelled the card some other way: apply what they picked now.
  const state = intent?.state
  useEffect(() => {
    if (!routesRef.current || !pausedRef.current || state === 'paused') return
    void flushRef.current()
  }, [state])

  useEffect(() => {
    if (resumeAt === undefined) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [resumeAt])

  // Leaving the conversation must not strand a card paused with unsent picks.
  useEffect(() => () => { void flushRef.current() }, [])

  return {
    holding: Boolean(routes),
    routes,
    secondsLeft: resumeAt === undefined ? 0 : Math.max(0, Math.ceil((resumeAt - now) / 1000)),
    touch,
    changeRoute,
    setPending,
    release
  }
}
