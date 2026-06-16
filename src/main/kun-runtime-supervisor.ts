/**
 * Crash-loop budget and status contract for the GUI-managed Kun
 * runtime. The supervisor in index.ts consumes these to auto-restart a
 * crashed runtime with backoff, and to stop retrying (circuit break)
 * when the runtime is crashing faster than it can recover.
 */

import type { KunRuntimeStatusPayload } from '../shared/kun-gui-api'

/** Shared with preload/renderer; the payload travels over `runtime:status`. */
export type KunRuntimeStatus = KunRuntimeStatusPayload

export type RestartVerdict =
  | { allowed: true; attempt: number; delayMs: number }
  | { allowed: false; attempt: number; delayMs: 0 }

export type RestartBudgetOptions = {
  windowMs: number
  maxRestarts: number
  baseDelayMs?: number
  delayFactor?: number
  now?: () => number
}

export const MAX_RESTART_DELAY_MS = 2_147_483_647

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Sliding-window restart budget: allows up to `maxRestarts` attempts per
 * `windowMs`, with exponential backoff delays (base, base*factor, ...).
 * Once the window is saturated the caller should circuit-break and wait
 * for a manual restart instead of burning CPU on a crash loop.
 */
export class RestartBudget {
  private readonly windowMs: number
  private readonly maxRestarts: number
  private readonly baseDelayMs: number
  private readonly delayFactor: number
  private readonly now: () => number
  private attempts: number[] = []

  constructor(options: RestartBudgetOptions) {
    this.windowMs = Math.max(1, finiteNumber(options.windowMs, 60_000))
    this.maxRestarts = Math.max(1, finiteNumber(options.maxRestarts, 3))
    this.baseDelayMs = Math.max(0, finiteNumber(options.baseDelayMs, 1_000))
    this.delayFactor = Math.max(1, finiteNumber(options.delayFactor, 3))
    this.now = options.now ?? (() => Date.now())
  }

  /** Ask for one restart attempt; records it when allowed. */
  note(): RestartVerdict {
    const at = this.now()
    this.attempts = this.attempts.filter((t) => at - t < this.windowMs)
    if (this.attempts.length >= this.maxRestarts) {
      return { allowed: false, attempt: this.attempts.length, delayMs: 0 }
    }
    this.attempts.push(at)
    const attempt = this.attempts.length
    return {
      allowed: true,
      attempt,
      delayMs: Math.min(
        MAX_RESTART_DELAY_MS,
        Math.round(this.baseDelayMs * Math.pow(this.delayFactor, attempt - 1))
      )
    }
  }

  /** Forget past attempts after the runtime proved stable again. */
  reset(): void {
    this.attempts = []
  }
}
