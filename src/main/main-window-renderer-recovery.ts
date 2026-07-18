import type { RenderProcessGoneDetails } from 'electron'

export const MAIN_WINDOW_RENDERER_RECOVERY_DELAY_MS = 250
export const MAIN_WINDOW_RENDERER_RECOVERY_MAX_ATTEMPTS = 2
export const MAIN_WINDOW_RENDERER_RECOVERY_WINDOW_MS = 60_000

// Chromium reports ERR_ABORTED while replacing an in-flight navigation. That
// is expected during reloads and must not start another recovery cycle.
const ERR_ABORTED = -3

export function shouldRecoverRendererProcess(
  reason: RenderProcessGoneDetails['reason']
): boolean {
  return reason !== 'clean-exit'
}

export function shouldRecoverMainFrameLoad(
  errorCode: number,
  isMainFrame: boolean
): boolean {
  return isMainFrame && errorCode !== ERR_ABORTED
}

/** Sliding-window guard that prevents a persistently crashing page from looping forever. */
export class MainWindowRendererRecoveryBudget {
  private attempts: number[] = []

  constructor(
    private readonly maxAttempts = MAIN_WINDOW_RENDERER_RECOVERY_MAX_ATTEMPTS,
    private readonly windowMs = MAIN_WINDOW_RENDERER_RECOVERY_WINDOW_MS
  ) {}

  reserve(now = Date.now()): number | null {
    this.attempts = this.attempts.filter((startedAt) => now - startedAt < this.windowMs)
    if (this.attempts.length >= this.maxAttempts) return null
    this.attempts.push(now)
    return this.attempts.length
  }
}
