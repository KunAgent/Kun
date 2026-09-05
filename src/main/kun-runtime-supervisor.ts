/**
 * Crash-loop budget and status contract for the GUI-managed Kun
 * runtime. The supervisor in index.ts consumes these to auto-restart a
 * crashed runtime with backoff, and to stop retrying (circuit break)
 * when the runtime is crashing faster than it can recover.
 */

import type { KunRuntimeStatusPayload } from '../shared/kun-gui-api'
import { ManagedRuntimeOperationCoordinator } from './runtime/managed-runtime-operation-coordinator'

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

  get limit(): number {
    return this.maxRestarts
  }

  /** Inspect the next restart attempt without consuming the budget. */
  preview(): RestartVerdict {
    return this.evaluate(false)
  }

  /** Ask for one restart attempt; records it when allowed. */
  note(): RestartVerdict {
    return this.evaluate(true)
  }

  private evaluate(record: boolean): RestartVerdict {
    const at = this.now()
    this.attempts = this.attempts.filter((t) => at - t < this.windowMs)
    if (this.attempts.length >= this.maxRestarts) {
      return { allowed: false, attempt: this.attempts.length, delayMs: 0 }
    }
    const attempt = this.attempts.length + 1
    if (record) this.attempts.push(at)
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

export type KunRuntimeSupervisorDeps<Settings> = {
  loadSettings: () => Promise<Settings>
  canAutoRestart: (settings: Settings) => boolean
  ensureRuntime: (settings: Settings) => Promise<unknown>
  restartRuntime: (settings: Settings) => Promise<void>
  checkHealth: (settings: Settings, timeoutMs: number) => Promise<boolean>
  isChildRunning: () => boolean
  isStopped: () => boolean
  publish: (status: KunRuntimeStatus) => void
  warn: (source: string, message: string, details?: unknown) => void
  error: (source: string, message: string, details?: unknown) => void
  sleep?: (ms: number) => Promise<void>
  setInterval?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void
}

/** Single owner for crash recovery, liveness monitoring, and runtime status. */
export class KunRuntimeSupervisor<Settings> {
  private readonly operations = new ManagedRuntimeOperationCoordinator<Settings>()
  private readonly restartBudget: RestartBudget
  private readonly watchdogIntervalMs: number
  private readonly watchdogFailureThreshold: number
  private readonly deps: KunRuntimeSupervisorDeps<Settings>
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private watchdogFailures = 0
  private watchdogTickInFlight = false
  private recoveryInFlight = false
  private managedRuntimeExpected = false
  private currentStatus: KunRuntimeStatus | null = null
  private hostLivenessPausedUntil = 0
  private hostLivenessEpoch = 0

  constructor(options: {
    deps: KunRuntimeSupervisorDeps<Settings>
    restartBudget?: RestartBudget
    watchdogIntervalMs?: number
    watchdogFailureThreshold?: number
  }) {
    this.deps = options.deps
    this.restartBudget = options.restartBudget ?? new RestartBudget({ windowMs: 60_000, maxRestarts: 3 })
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 30_000
    this.watchdogFailureThreshold = options.watchdogFailureThreshold ?? 3
  }

  get lastStatus(): KunRuntimeStatus | null {
    return this.currentStatus
  }

  /**
   * Whether Main currently expects the managed Runtime to exist. This is
   * intentionally independent from the child/discovery signal: discovery can
   * disappear during a crash, while an explicit stop must suppress recovery.
   */
  get isManagedRuntimeExpected(): boolean {
    return this.managedRuntimeExpected
  }

  /**
   * Set by the lifecycle owner as soon as durable settings require a managed
   * Runtime, and reset before an explicit stop. This deliberately does not
   * wait for the first successful launch: a cold-start failure must leave the
   * watchdog armed so the product can recover without user intervention.
   */
  setManagedRuntimeExpected(expected: boolean): void {
    if (this.managedRuntimeExpected === expected) return
    this.managedRuntimeExpected = expected
    this.watchdogFailures = 0
    if (expected) {
      this.startWatchdog()
    } else {
      this.stopWatchdog()
    }
  }

  hasPendingOperation(): boolean {
    return this.operations.hasPendingOperation()
  }

  latestOr(fallback: Settings): Settings {
    return this.operations.latestOr(fallback)
  }

  noteLatest(settings: Settings): void {
    this.operations.noteLatest(settings)
  }

  ensure(fingerprint: string, operation: () => Promise<Settings>): Promise<Settings> {
    return this.operations.ensure(fingerprint, operation)
  }

  restart(operation: () => Promise<void>): Promise<void> {
    return this.operations.restart(operation)
  }

  replace(operation: () => Promise<void>): Promise<void> {
    return this.operations.replace(operation)
  }

  enqueueSettingsApply(
    operation: () => Promise<void>,
    onError: (error: unknown) => void,
    coalesceKey?: string
  ): void {
    this.operations.enqueueSettingsApply(operation, onError, coalesceKey)
  }

  waitForIdle(): Promise<void> {
    return this.operations.waitForIdle()
  }

  publish(status: Omit<KunRuntimeStatus, 'at'>): void {
    const full: KunRuntimeStatus = { ...status, at: new Date().toISOString() }
    this.currentStatus = full
    this.deps.publish(full)
  }

  noteHealthy(source: string): void {
    // A single successful probe is not proof of a stable Runtime. Keep recent
    // restart attempts in the sliding window so a start-crash-start loop can
    // still trip the circuit breaker. Attempts age out naturally.
    this.watchdogFailures = 0
    if (!this.managedRuntimeExpected) return
    this.startWatchdog()
    if (
      this.currentStatus &&
      (this.currentStatus.state !== 'running' || this.currentStatus.rolledBack === true)
    ) {
      this.publish({ state: 'running', source })
    }
  }

  noteHostSuspended(): void {
    this.hostLivenessEpoch += 1
    this.hostLivenessPausedUntil = Number.POSITIVE_INFINITY
    this.watchdogFailures = 0
  }

  noteHostResumed(graceMs = 20_000): void {
    this.hostLivenessEpoch += 1
    this.hostLivenessPausedUntil = Date.now() + Math.max(0, graceMs)
    this.watchdogFailures = 0
    if (this.managedRuntimeExpected) this.startWatchdog()
  }

  handleUnexpectedExit(info: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }): void {
    if (this.isHostLivenessPaused()) return
    void this.recoverFromCrash(info).catch((error: unknown) => {
      this.deps.error('kun-supervisor', 'supervised restart crashed', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }

  startWatchdog(): void {
    if (this.watchdogTimer) return
    const schedule = this.deps.setInterval ?? setInterval
    const timer = schedule(() => {
      void this.watchdogTick().catch((error: unknown) => {
        this.deps.warn('kun-watchdog', 'watchdog tick failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }, this.watchdogIntervalMs)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    this.watchdogTimer = timer as ReturnType<typeof setInterval>
  }

  stopWatchdog(): void {
    if (!this.watchdogTimer) return
    const cancel = this.deps.clearInterval ?? clearInterval
    cancel(this.watchdogTimer)
    this.watchdogTimer = null
  }

  async watchdogTick(): Promise<void> {
    if (this.watchdogTickInFlight || this.deps.isStopped()) return
    if (this.isHostLivenessPaused()) return
    if (!this.managedRuntimeExpected) return
    if (this.recoveryInFlight || this.operations.hasPendingOperation()) return
    this.watchdogTickInFlight = true
    const hostEpoch = this.hostLivenessEpoch
    try {
      const settings = await this.deps.loadSettings()
      if (!this.isHostEpochActive(hostEpoch)) return
      if (!this.managedRuntimeExpected || !this.deps.canAutoRestart(settings)) return

      let childRunning = this.deps.isChildRunning()
      if (childRunning && await this.deps.checkHealth(settings, 5_000)) {
        if (!this.isHostEpochActive(hostEpoch)) return
        this.noteHealthy('watchdog')
        return
      }

      // checkHealth refreshes discovery; a dead shared-runtime PID may have been
      // cleared from the adapter cache. Re-read before counting unresponsive
      // failures so recovery can take the missing/ensure path (#1116).
      childRunning = this.deps.isChildRunning()
      if (!this.isHostEpochActive(hostEpoch)) return
      if (!childRunning) {
        await this.recoverFromWatchdog('missing', hostEpoch)
        return
      }

      this.watchdogFailures += 1
      this.deps.warn(
        'kun-watchdog',
        `health probe failed (${this.watchdogFailures}/${this.watchdogFailureThreshold})`
      )
      if (this.watchdogFailures < this.watchdogFailureThreshold) return
      this.watchdogFailures = 0
      await this.recoverFromWatchdog('unresponsive', hostEpoch)
    } finally {
      this.watchdogTickInFlight = false
    }
  }

  private isHostLivenessPaused(): boolean {
    return Date.now() < this.hostLivenessPausedUntil
  }

  private isHostEpochActive(epoch: number): boolean {
    return epoch === this.hostLivenessEpoch && !this.isHostLivenessPaused()
  }

  private async recoverFromWatchdog(
    reason: 'missing' | 'unresponsive',
    hostEpoch = this.hostLivenessEpoch
  ): Promise<void> {
    if (!this.isHostEpochActive(hostEpoch)) return
    if (!this.managedRuntimeExpected || this.deps.isStopped()) return
    if (this.recoveryInFlight) return
    this.recoveryInFlight = true
    try {
      await this.recoverFromWatchdogOnce(reason, hostEpoch)
    } finally {
      this.recoveryInFlight = false
    }
  }

  private async recoverFromWatchdogOnce(
    reason: 'missing' | 'unresponsive',
    hostEpoch: number
  ): Promise<void> {
    if (!this.isHostEpochActive(hostEpoch)) return
    const preview = this.restartBudget.preview()
    if (!preview.allowed) {
      this.publish({
        state: 'failed',
        source: 'watchdog',
        attempt: preview.attempt,
        maxAttempts: this.restartBudget.limit,
        message: 'Kun recovery exceeded its restart budget; automatic restarts are paused.'
      })
      return
    }

    await (this.deps.sleep ?? defaultSleep)(preview.delayMs)
    if (!this.isHostEpochActive(hostEpoch)) return
    if (!this.managedRuntimeExpected || this.deps.isStopped()) return
    if (this.operations.hasPendingOperation()) return
    let recoveryAttempt = preview.attempt
    try {
      const currentSettings = await this.deps.loadSettings()
      if (!this.isHostEpochActive(hostEpoch)) return
      if (!this.managedRuntimeExpected || this.deps.isStopped() ||
          !this.deps.canAutoRestart(currentSettings)) return

      const childRunning = this.deps.isChildRunning()
      if (childRunning && await this.deps.checkHealth(currentSettings, 5_000)) {
        if (!this.isHostEpochActive(hostEpoch)) return
        this.noteHealthy('watchdog')
        return
      }
      if (!this.managedRuntimeExpected || this.deps.isStopped() ||
          this.operations.hasPendingOperation() || !this.isHostEpochActive(hostEpoch)) return

      const verdict = this.restartBudget.note()
      if (!verdict.allowed) {
        this.publish({
          state: 'failed',
          source: 'watchdog',
          attempt: verdict.attempt,
          maxAttempts: this.restartBudget.limit,
          message: 'Kun recovery exceeded its restart budget; automatic restarts are paused.'
        })
        return
      }
      recoveryAttempt = verdict.attempt
      this.publish({
        state: 'restarting',
        source: 'watchdog',
        attempt: verdict.attempt,
        maxAttempts: this.restartBudget.limit,
        message: reason === 'missing'
          ? 'Kun is expected to be running but its process or discovery record is missing; recovering it.'
          : 'Kun stopped responding to health checks; restarting it.'
      })

      if (childRunning) {
        if (!this.isHostEpochActive(hostEpoch)) return
        await this.deps.restartRuntime(currentSettings)
      } else {
        if (!this.isHostEpochActive(hostEpoch)) return
        await this.deps.ensureRuntime(currentSettings)
      }
      if (!this.isHostEpochActive(hostEpoch)) return
      if (!this.managedRuntimeExpected || this.deps.isStopped()) return
      this.noteHealthy('watchdog')
    } catch (error) {
      if (!this.isHostEpochActive(hostEpoch) ||
          !this.managedRuntimeExpected || this.deps.isStopped()) return
      this.publish({
        state: 'failed',
        source: 'watchdog',
        attempt: recoveryAttempt,
        maxAttempts: this.restartBudget.limit,
        message: `Kun automatic recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    }
  }

  private async recoverFromCrash(info: {
    code: number | null
    signal: NodeJS.Signals | null
    stderrTail: string
  }): Promise<void> {
    const hostEpoch = this.hostLivenessEpoch
    if (!this.isHostEpochActive(hostEpoch)) return
    if (this.deps.isStopped() || !this.managedRuntimeExpected) return
    const exitLabel = info.signal ? `signal ${info.signal}` : `code ${info.code ?? 'unknown'}`
    this.publish({
      state: 'crashed',
      source: 'supervisor',
      message: `Kun exited unexpectedly (${exitLabel}).`,
      stderrTail: info.stderrTail
    })
    if (this.recoveryInFlight) return
    this.recoveryInFlight = true
    try {
      const settings = await this.deps.loadSettings()
      if (!this.isHostEpochActive(hostEpoch)) return
      if (!this.deps.canAutoRestart(settings)) {
        this.publish({
          state: 'stopped',
          source: 'supervisor',
          message: 'Kun exited and automatic restart is unavailable (missing API key or auto-start disabled).'
        })
        return
      }
      let lastError = ''
      for (;;) {
        if (this.deps.isStopped() || !this.managedRuntimeExpected ||
            !this.isHostEpochActive(hostEpoch)) return
        const preview = this.restartBudget.preview()
        if (!preview.allowed) {
          this.publish({
            state: 'failed',
            source: 'supervisor',
            attempt: preview.attempt,
            maxAttempts: this.restartBudget.limit,
            message: lastError
              ? `Kun keeps crashing; automatic restarts are paused. Last error: ${lastError}`
              : 'Kun keeps crashing; automatic restarts are paused. Check the runtime logs, then retry.',
            stderrTail: info.stderrTail
          })
          return
        }
        await (this.deps.sleep ?? defaultSleep)(preview.delayMs)
        if (this.deps.isStopped() || !this.managedRuntimeExpected ||
            !this.isHostEpochActive(hostEpoch)) return
        let recoveryAttempt = preview.attempt
        let budgetNoted = false
        try {
          const currentSettings = await this.deps.loadSettings()
          if (!this.isHostEpochActive(hostEpoch)) return
          const verdict = this.restartBudget.note()
          if (!verdict.allowed) continue
          recoveryAttempt = verdict.attempt
          budgetNoted = true
          this.publish({
            state: 'restarting',
            source: 'supervisor',
            attempt: verdict.attempt,
            maxAttempts: this.restartBudget.limit,
            message: `Restarting Kun automatically (attempt ${verdict.attempt}/${this.restartBudget.limit}).`
          })
          await this.deps.ensureRuntime(currentSettings)
          if (this.deps.isStopped() || !this.managedRuntimeExpected ||
              !this.isHostEpochActive(hostEpoch)) return
          this.noteHealthy('supervisor')
          return
        } catch (error) {
          if (!this.isHostEpochActive(hostEpoch) ||
              this.deps.isStopped() || !this.managedRuntimeExpected) return
          if (!budgetNoted) {
            const verdict = this.restartBudget.note()
            if (!verdict.allowed) continue
            recoveryAttempt = verdict.attempt
          }
          lastError = error instanceof Error ? error.message : String(error)
          this.deps.warn(
            'kun-supervisor',
            `automatic restart attempt ${recoveryAttempt} failed: ${lastError}`
          )
        }
      }
    } finally {
      this.recoveryInFlight = false
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
