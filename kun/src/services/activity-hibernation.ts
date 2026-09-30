import type { ActivityRow } from '../contracts/activity.js'

export const ACTIVITY_HIBERNATION_SCAN_MS = 60_000
export const ACTIVITY_FOREGROUND_TTL_MS = 30_000

export type ActivityHibernationThresholds = {
  /** Dormancy release gate (ade.hibernation.enabled); stall detection always runs. */
  enabled: boolean
  stallStructuredMs: number
  stallTerminalMs: number
  dormantMs: number
}

export type ActivityHibernationDeps = {
  /** Row write with 'inferred' provenance. */
  apply(unitId: string, patch: { stalled?: boolean; residency?: 'live' | 'dormant' }): void
  list(): ActivityRow[]
  /** Last runtime-event time for the unit (06 §6 quiet window). */
  lastEventAt(unitId: string): number | undefined
  /**
   * Dormancy conditions 2-3 (06 §7.2): unfinished dispatches or unanswered
   * questions for the unit — `ManagerRuntime.hasOpenWork` for worker rows.
   */
  hasOpenWork(row: ActivityRow): Promise<boolean>
  /**
   * Condition 6: the harness can resume — native resume, or portable
   * continuation (always true for structured harnesses; terminal agents
   * additionally need `terminal.resumeArgs`, decided by the caller).
   */
  canResume(row: ActivityRow): boolean
  /**
   * Drop the resident runtime — ACP pool entry, terminal PTY — while the
   * session binding survives for native/portable resume on the next turn.
   */
  releaseResident(row: ActivityRow): void | Promise<void>
}

export type ActivityHibernationOptions = {
  now?: () => number
  thresholds?: () => ActivityHibernationThresholds
  scanMs?: number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

const DEFAULT_THRESHOLDS: ActivityHibernationThresholds = {
  enabled: true,
  stallStructuredMs: 10 * 60_000,
  stallTerminalMs: 20 * 60_000,
  dormantMs: 30 * 60_000
}

/**
 * Periodic scanner for the two ActivityStore heuristics (docs/ade/06 §6,
 * §7.2): quiet `working` rows are marked `stalled` (a hint only — no state
 * or runtime change), and idle worker/terminal-agent rows go `dormant` so
 * their resident connections can be released. Clients report the foreground
 * thread via POST /v1/activity/foreground; marks expire after 30 s so a
 * disconnected client cannot pin a unit live.
 */
export class ActivityHibernation {
  private timer?: ReturnType<typeof setInterval>
  private readonly foreground = new Map<string, number>()

  constructor(
    private readonly deps: ActivityHibernationDeps,
    private readonly options: ActivityHibernationOptions = {}
  ) {}

  start(): void {
    if (this.timer) return
    const setIntervalFn = this.options.setIntervalFn ?? setInterval
    this.timer = setIntervalFn(() => {
      void this.scanOnce().catch((error: unknown) =>
        console.warn('[kun] activity hibernation scan failed:', error))
    }, this.options.scanMs ?? ACTIVITY_HIBERNATION_SCAN_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    ;(this.options.clearIntervalFn ?? clearInterval)(this.timer)
    this.timer = undefined
  }

  /** A client reports `threadId` as its foreground session (30 s TTL). */
  markForeground(threadId: string): void {
    this.foreground.set(threadId, this.now() + ACTIVITY_FOREGROUND_TTL_MS)
  }

  isForeground(threadId: string): boolean {
    const until = this.foreground.get(threadId)
    if (until === undefined) return false
    if (until > this.now()) return true
    this.foreground.delete(threadId)
    return false
  }

  async scanOnce(): Promise<void> {
    const now = this.now()
    const thresholds = this.options.thresholds?.() ?? DEFAULT_THRESHOLDS
    this.sweepForeground(now)
    for (const row of this.deps.list()) {
      if (this.isStalled(row, now, thresholds)) {
        this.deps.apply(row.unitId, { stalled: true })
      }
    }
    if (!thresholds.enabled) return
    for (const row of this.deps.list()) {
      try {
        if (!(await this.isDormantCandidate(row, now, thresholds))) continue
        this.deps.apply(row.unitId, { residency: 'dormant' })
        await this.deps.releaseResident(row)
      } catch (error) {
        console.warn(`[kun] activity dormancy check failed for ${row.unitId}:`, error)
      }
    }
  }

  private isStalled(
    row: ActivityRow,
    now: number,
    thresholds: ActivityHibernationThresholds
  ): boolean {
    if (row.stalled || row.residency !== 'live' || row.mainState !== 'working') return false
    // Waiting on a manager question is a live wait, not a stall (06 §6).
    if (row.waitingReason === 'question') return false
    const limit = row.kind === 'terminal-agent'
      ? thresholds.stallTerminalMs
      : thresholds.stallStructuredMs
    const last = this.deps.lastEventAt(row.unitId) ?? Date.parse(row.updatedAt)
    return now - last > limit
  }

  private async isDormantCandidate(
    row: ActivityRow,
    now: number,
    thresholds: ActivityHibernationThresholds
  ): Promise<boolean> {
    if (row.residency !== 'live') return false
    if (row.kind !== 'worker' && row.kind !== 'terminal-agent') return false
    if (row.mainState !== 'done' && row.mainState !== 'idle') return false
    if (row.children.working + row.children.waiting > 0) return false
    if (await this.deps.hasOpenWork(row)) return false
    if (this.isForeground(row.threadId)) return false
    if (now - Date.parse(row.stateSince) <= thresholds.dormantMs) return false
    return this.deps.canResume(row)
  }

  private sweepForeground(now: number): void {
    for (const [threadId, until] of this.foreground) {
      if (until <= now) this.foreground.delete(threadId)
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}
