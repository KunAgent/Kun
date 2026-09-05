import type {
  RuntimeFlavor,
  RuntimeRegistration,
  ThreadExecutionLease
} from '../contracts/runtime-flavor.js'

export const HOST_RESUME_GRACE_MS = 20_000
const HOST_CLOCK_GAP_THRESHOLD_MS = 5_000
const HOST_CLOCK_ROLLBACK_THRESHOLD_MS = 60_000

export type ManagerHostLivenessSnapshot = {
  suspendedAtMs: number | null
  lastReconcileAtMs: number | null
  lastReportObservedAtMs: number | null
  lastReportSourceId: string | null
  lastReportPhase: 'suspend' | 'resume' | null
  sequences: Record<string, number>
}

type RuntimeSlot = {
  registration: RuntimeRegistration
  lastHeartbeatAt: string
}

export class ManagerHostLivenessState {
  private suspendedAtMs: number | null = null
  private lastReconcileAtMs: number | null = null
  private lastReportObservedAtMs: number | null = null
  private lastReportSourceId: string | null = null
  private lastReportPhase: 'suspend' | 'resume' | null = null
  private readonly sequences = new Map<string, number>()

  static restore(snapshot: ManagerHostLivenessSnapshot): ManagerHostLivenessState {
    const state = new ManagerHostLivenessState()
    state.suspendedAtMs = snapshot.suspendedAtMs
    state.lastReconcileAtMs = snapshot.lastReconcileAtMs
    state.lastReportObservedAtMs = snapshot.lastReportObservedAtMs
    state.lastReportSourceId = snapshot.lastReportSourceId
    state.lastReportPhase = snapshot.lastReportPhase
    for (const [sourceId, sequence] of Object.entries(snapshot.sequences)) {
      state.sequences.set(sourceId, sequence)
    }
    return state
  }

  snapshot(): ManagerHostLivenessSnapshot {
    return {
      suspendedAtMs: this.suspendedAtMs,
      lastReconcileAtMs: this.lastReconcileAtMs,
      lastReportObservedAtMs: this.lastReportObservedAtMs,
      lastReportSourceId: this.lastReportSourceId,
      lastReportPhase: this.lastReportPhase,
      sequences: Object.fromEntries(this.sequences)
    }
  }

  noteSuspended(observedAt: Date): void {
    const observedAtMs = observedAt.getTime()
    this.suspendedAtMs = this.suspendedAtMs === null
      ? observedAtMs
      : Math.min(this.suspendedAtMs, observedAtMs)
    this.lastReconcileAtMs = this.suspendedAtMs
  }

  noteResumed(observedAt: Date, extend: (deltaMs: number, aliveAtMs: number) => void): void {
    const resumedAtMs = observedAt.getTime()
    const inferredGapStart = this.lastReconcileAtMs !== null &&
      resumedAtMs >= this.lastReconcileAtMs
      ? this.lastReconcileAtMs
      : null
    const suspendedAtMs = this.suspendedAtMs ?? inferredGapStart
    this.suspendedAtMs = null
    this.lastReconcileAtMs = Math.max(this.lastReconcileAtMs ?? resumedAtMs, resumedAtMs)
    if (suspendedAtMs !== null) {
      extend(Math.max(0, resumedAtMs - suspendedAtMs) + HOST_RESUME_GRACE_MS, suspendedAtMs)
    }
  }

  report(input: {
    phase: 'suspend' | 'resume'
    sourceId: string
    sequence: number
    observedAt: Date
    receivedAt?: Date
  }, extend: (deltaMs: number, aliveAtMs: number) => void): boolean {
    const observedAtMs = input.observedAt.getTime()
    const receivedAtMs = (input.receivedAt ?? new Date()).getTime()
    const previous = this.sequences.get(input.sourceId) ?? 0
    const retiredSource = previous > 0 && this.lastReportSourceId !== null &&
      input.sourceId !== this.lastReportSourceId
    const clockRolledBack = this.lastReportObservedAtMs !== null &&
      this.lastReportObservedAtMs - receivedAtMs > HOST_CLOCK_ROLLBACK_THRESHOLD_MS &&
      Math.abs(observedAtMs - receivedAtMs) <= HOST_CLOCK_ROLLBACK_THRESHOLD_MS
    const globallyStale = !clockRolledBack && this.lastReportObservedAtMs !== null && (
      observedAtMs < this.lastReportObservedAtMs ||
      (observedAtMs === this.lastReportObservedAtMs && input.sourceId !== this.lastReportSourceId)
    )
    if (input.sequence <= previous || retiredSource || globallyStale) {
      return false
    }
    // Consecutive resume notifications are idempotent while Manager's own
    // clock samples show no missing interval. A genuine unreported sleep still
    // has a large reconcile gap and is recovered once here.
    const reconcileGapMs = this.lastReconcileAtMs === null
      ? Number.POSITIVE_INFINITY
      : observedAtMs - this.lastReconcileAtMs
    const duplicateResume = input.phase === 'resume' && this.lastReportPhase === 'resume' &&
      input.sourceId === this.lastReportSourceId && input.sequence === previous + 1 &&
      this.suspendedAtMs === null && reconcileGapMs <= HOST_CLOCK_GAP_THRESHOLD_MS
    this.sequences.set(input.sourceId, input.sequence)
    this.lastReportObservedAtMs = observedAtMs
    this.lastReportSourceId = input.sourceId
    this.lastReportPhase = input.phase
    if (input.phase === 'suspend') this.noteSuspended(input.observedAt)
    else if (duplicateResume) {
      this.lastReconcileAtMs = Math.max(this.lastReconcileAtMs ?? observedAtMs, observedAtMs)
    } else this.noteResumed(input.observedAt, extend)
    return true
  }

  beforeReconcile(
    now: Date,
    extend: (deltaMs: number, aliveAtMs: number) => void
  ): boolean {
    return this.beforeExpiry(now, extend, true)
  }

  beforeOperation(
    now: Date,
    extend: (deltaMs: number, aliveAtMs: number) => void
  ): boolean {
    return this.beforeExpiry(now, extend, false)
  }

  private beforeExpiry(
    now: Date,
    extend: (deltaMs: number, aliveAtMs: number) => void,
    recordClockSample: boolean
  ): boolean {
    const nowMs = now.getTime()
    if (this.suspendedAtMs !== null) {
      if (nowMs - this.suspendedAtMs > HOST_CLOCK_GAP_THRESHOLD_MS) {
        this.markAutomaticRecovery(nowMs)
        this.noteResumed(now, extend)
      } else {
        return false
      }
    }
    if (this.lastReconcileAtMs !== null) {
      const gapMs = nowMs - this.lastReconcileAtMs
      if (gapMs > HOST_CLOCK_GAP_THRESHOLD_MS) {
        const aliveAtMs = this.lastReconcileAtMs
        this.lastReconcileAtMs = nowMs
        this.markAutomaticRecovery(nowMs)
        extend(gapMs + HOST_RESUME_GRACE_MS, aliveAtMs)
      }
    }
    if (recordClockSample) this.lastReconcileAtMs = nowMs
    return true
  }

  private markAutomaticRecovery(nowMs: number): void {
    // Advance the global report watermark so a delayed pre-wake suspend cannot
    // put the host back into a suspended state after clock-gap recovery.
    this.lastReportObservedAtMs = nowMs
    this.lastReportPhase = 'resume'
  }

  expirationReference(now: Date): Date {
    return new Date(this.suspendedAtMs ?? now.getTime())
  }
}

export function extendHostLivenessDeadlines(
  slots: Map<RuntimeFlavor, RuntimeSlot>,
  leases: Map<string, ThreadExecutionLease>,
  deltaMs: number,
  aliveAtMs: number,
  heartbeatTtlMs: number
): boolean {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return false
  let changed = false
  for (const [flavor, slot] of slots) {
    const heartbeatMs = Date.parse(slot.lastHeartbeatAt)
    if (!Number.isFinite(heartbeatMs) || aliveAtMs - heartbeatMs > heartbeatTtlMs) continue
    slots.set(flavor, {
      ...slot,
      lastHeartbeatAt: new Date(heartbeatMs + deltaMs).toISOString()
    })
    changed = true
  }
  for (const [threadId, lease] of leases) {
    const expiresAtMs = Date.parse(lease.expiresAt)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= aliveAtMs) continue
    leases.set(threadId, {
      ...lease,
      expiresAt: new Date(expiresAtMs + deltaMs).toISOString()
    })
    changed = true
  }
  return changed
}
