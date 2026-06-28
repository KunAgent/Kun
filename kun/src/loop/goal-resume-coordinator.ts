/**
 * Goal auto-resume coordinator.
 *
 * Goal mode runs as a single long-lived turn that self-continues *within*
 * its own loop. When that turn ends without finishing the goal (an error, the
 * per-turn model-step budget, or a clean stop while the objective is still
 * unmet) and the goal is still `active`, nothing used to relaunch it — the
 * goal banner kept showing "in progress" while the runtime sat idle
 * (KunAgent/Kun#370). This coordinator owns the cross-turn resume policy:
 *
 * - It relaunches a continuation turn after a goal turn settles without
 *   finishing the goal (path B: an error, the step-budget, or a clean stop
 *   that left the goal active) and after a runtime restart strands an active
 *   goal (path A).
 * - Consecutive *no-progress* failures are bounded with exponential backoff;
 *   once the budget is exhausted the goal is moved out of `active` so the UI
 *   stops lying. A failure that made real progress resets the counter, so a
 *   genuinely long goal keeps going as long as it keeps advancing.
 *
 * The coordinator holds no domain knowledge: every effect (launch a turn,
 * read the current goal, check whether a turn is running) is injected, which
 * also keeps it unit-testable with a fake timer.
 */

/** A cancellable scheduled callback. */
export type GoalResumeTimer = { cancel: () => void }

export type GoalResumeCoordinatorDeps = {
  /** Launch a fresh continuation turn for the thread's active goal. */
  launch: (threadId: string) => Promise<void>
  /**
   * Re-read the thread's goal and return a stable key for it when (and only
   * when) it is still `active`; return `null` otherwise. Letting the
   * coordinator re-validate at fire time avoids resuming a goal that was
   * completed, cleared, or replaced while a backoff timer was pending.
   */
  getActiveGoalKey: (threadId: string) => Promise<string | null>
  /** Whether the thread currently has a turn running (avoids double-launch). */
  isThreadBusy: (threadId: string) => Promise<boolean>
  /** Schedule a delayed callback. Overridable for tests. */
  setTimer?: (fn: () => void, delayMs: number) => GoalResumeTimer
  /** Diagnostic sink; defaults to `console.warn`. */
  log?: (message: string) => void
  /** Consecutive no-progress failures tolerated before blocking the goal. */
  maxNoProgressAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export const DEFAULT_MAX_GOAL_RESUME_NO_PROGRESS_ATTEMPTS = 5
export const DEFAULT_GOAL_RESUME_BASE_DELAY_MS = 2_000
export const DEFAULT_GOAL_RESUME_MAX_DELAY_MS = 60_000

type ThreadResumeState = {
  goalKey: string
  /** Consecutive no-progress resume attempts for the current goal. */
  attempts: number
  timer?: GoalResumeTimer
}

function defaultSetTimer(fn: () => void, delayMs: number): GoalResumeTimer {
  const handle = setTimeout(fn, delayMs)
  // Don't let a pending resume keep the process alive on shutdown.
  if (typeof (handle as { unref?: () => void }).unref === 'function') {
    ;(handle as { unref: () => void }).unref()
  }
  return { cancel: () => clearTimeout(handle) }
}

export class GoalResumeCoordinator {
  private readonly deps: GoalResumeCoordinatorDeps
  private readonly setTimer: (fn: () => void, delayMs: number) => GoalResumeTimer
  private readonly maxNoProgressAttempts: number
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly state = new Map<string, ThreadResumeState>()
  private shuttingDown = false

  constructor(deps: GoalResumeCoordinatorDeps) {
    this.deps = deps
    this.setTimer = deps.setTimer ?? defaultSetTimer
    this.maxNoProgressAttempts =
      deps.maxNoProgressAttempts ?? DEFAULT_MAX_GOAL_RESUME_NO_PROGRESS_ATTEMPTS
    this.baseDelayMs = deps.baseDelayMs ?? DEFAULT_GOAL_RESUME_BASE_DELAY_MS
    this.maxDelayMs = deps.maxDelayMs ?? DEFAULT_GOAL_RESUME_MAX_DELAY_MS
  }

  /**
   * Record that a goal turn settled without finishing the goal and schedule a
   * backoff resume. Covers both interrupted turns (model/network/tool error or
   * the per-turn model-step budget) and clean turns that stopped while the
   * objective was still unmet.
   *
   * Returns `'exhausted'` when the consecutive no-progress budget is spent —
   * the caller should move the goal out of `active` (e.g. to `blocked`).
   */
  noteGoalTurnSettled(input: {
    threadId: string
    goalKey: string
    madeProgress: boolean
  }): 'scheduled' | 'exhausted' | 'skipped' {
    if (this.shuttingDown) return 'skipped'
    const { threadId, goalKey, madeProgress } = input
    let entry = this.state.get(threadId)
    if (!entry || entry.goalKey !== goalKey) {
      entry?.timer?.cancel()
      entry = { goalKey, attempts: 0 }
      this.state.set(threadId, entry)
    }
    entry.timer?.cancel()
    entry.timer = undefined
    // A failure that still made progress resets the streak, so a long goal
    // that keeps advancing always reschedules and is never blocked; only a
    // run of *consecutive* no-progress failures burns the budget.
    if (madeProgress) entry.attempts = 0
    else entry.attempts += 1
    if (entry.attempts > this.maxNoProgressAttempts) {
      this.state.delete(threadId)
      return 'exhausted'
    }
    const delayMs = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** Math.max(0, entry.attempts - 1)
    )
    entry.timer = this.setTimer(() => {
      void this.fire(threadId, goalKey)
    }, delayMs)
    return 'scheduled'
  }

  /**
   * Resume a goal stranded by a runtime restart (path A). Launches
   * immediately (subject to re-validation) and seeds the no-progress counter
   * so later failures of the resumed turn start counting from zero.
   */
  async resumeInterrupted(threadId: string): Promise<boolean> {
    if (this.shuttingDown) return false
    try {
      const goalKey = await this.deps.getActiveGoalKey(threadId)
      if (!goalKey) return false
      if (await this.deps.isThreadBusy(threadId)) return false
      this.state.get(threadId)?.timer?.cancel()
      this.state.set(threadId, { goalKey, attempts: 0 })
      await this.deps.launch(threadId)
      return true
    } catch (error) {
      this.log(`goal resume on startup failed for ${threadId}: ${String(error)}`)
      return false
    }
  }

  /** Drop any pending resume for a thread (goal completed/cleared, or turn succeeded). */
  clear(threadId: string): void {
    const entry = this.state.get(threadId)
    if (!entry) return
    entry.timer?.cancel()
    this.state.delete(threadId)
  }

  /** Cancel all pending resumes; called on runtime shutdown. */
  shutdown(): void {
    this.shuttingDown = true
    for (const entry of this.state.values()) entry.timer?.cancel()
    this.state.clear()
  }

  private async fire(threadId: string, goalKey: string): Promise<void> {
    if (this.shuttingDown) return
    const entry = this.state.get(threadId)
    if (!entry || entry.goalKey !== goalKey) return
    entry.timer = undefined
    try {
      const currentKey = await this.deps.getActiveGoalKey(threadId)
      if (currentKey !== goalKey) {
        // Goal completed, blocked, paused, cleared, or replaced while we waited.
        this.state.delete(threadId)
        return
      }
      if (await this.deps.isThreadBusy(threadId)) {
        // Another turn is already running; its completion re-drives resume.
        return
      }
      await this.deps.launch(threadId)
    } catch (error) {
      this.log(`goal resume launch failed for ${threadId}: ${String(error)}`)
    }
  }

  private log(message: string): void {
    if (this.deps.log) this.deps.log(message)
    else console.warn(`[kun] ${message}`)
  }
}
